const os = require('os')
const dns = require('dns').promises
const { program: optionparser } = require('commander')
const { Kafka } = require('kafkajs')
const mariadb = require('mariadb')
const MemcachePlus = require('memcache-plus')
const express = require('express')

const app = express()
const cacheTimeSecs = 15
const numberOfMissions = 12

// -------------------------------------------------------
// Command-line options (with sensible defaults)
// -------------------------------------------------------

let options = optionparser
	.storeOptionsAsProperties(true)
	// Web server
	.option('--port <port>', "Web server port", 3000)
	// Kafka options
	.option('--kafka-broker <host:port>', "Kafka bootstrap host:port", "my-cluster-kafka-bootstrap:9092")
	.option('--kafka-topic-tracking <topic>', "Kafka topic to tracking data send to", "tracking-data")
	.option('--kafka-client-id < id > ', "Kafka client ID", "tracker-" + Math.floor(Math.random() * 100000))
	// Memcached options
	.option('--memcached-hostname <hostname>', 'Memcached hostname (may resolve to multiple IPs)', 'my-memcached-service')
	.option('--memcached-port <port>', 'Memcached port', 11211)
	.option('--memcached-update-interval <ms>', 'Interval to query DNS for memcached IPs', 5000)
	// Database options
	.option('--mariadb-host <host>', 'MariaDB host', 'my-app-mariadb-service')
	.option('--mariadb-port <port>', 'MariaDB port', 3306)
	.option('--mariadb-schema <db>', 'MariaDB Schema/database', 'popular')
	.option('--mariadb-username <username>', 'MariaDB username', 'root')
	.option('--mariadb-password <password>', 'MariaDB password', 'mysecretpw')
	// Misc
	.addHelpCommand()
	.parse()
	.opts()

// -------------------------------------------------------
// Database Configuration
// -------------------------------------------------------

const pool = mariadb.createPool({
	host: options.mariadbHost,
	port: options.mariadbPort,
	database: options.mariadbSchema,
	user: options.mariadbUsername,
	password: options.mariadbPassword,
	connectionLimit: 5
})

async function executeQuery(query, data) {
	let connection
	try {
		connection = await pool.getConnection()
		console.log("Executing query ", query)
		let res = await connection.query({ rowsAsArray: true, sql: query }, data)
		return res
	} finally {
		if (connection)
			connection.end()
	}
}

// -------------------------------------------------------
// Memcache Configuration
// -------------------------------------------------------

//Connect to the memcached instances
let memcached = null
let memcachedServers = []

async function getMemcachedServersFromDns() {
	try {
		// Query all IP addresses for this hostname
		let queryResult = await dns.lookup(options.memcachedHostname, { all: true })

		// Create IP:Port mappings
		let servers = queryResult.map(el => el.address + ":" + options.memcachedPort)

		// Check if the list of servers has changed
		// and only create a new object if the server list has changed
		if (memcachedServers.sort().toString() !== servers.sort().toString()) {
			console.log("Updated memcached server list to ", servers)
			memcachedServers = servers

			//Disconnect an existing client
			if (memcached)
				await memcached.disconnect()

			memcached = new MemcachePlus(memcachedServers);
		}
	} catch (e) {
		console.log("Unable to get memcache servers (yet)")
	}
}

//Initially try to connect to the memcached servers, then each 5s update the list
getMemcachedServersFromDns()
setInterval(() => getMemcachedServersFromDns(), options.memcachedUpdateInterval)


//Get data from cache if a cache exists yet
async function getFromCache(key) {
	if (!memcached) {
		console.log(`No memcached instance available, memcachedServers = ${memcachedServers}`)
		return null;
	}
	return await memcached.get(key);
}

// -------------------------------------------------------
// Kafka Configuration
// -------------------------------------------------------

// Kafka connection
const kafka = new Kafka({
	clientId: options.kafkaClientId,
	brokers: [options.kafkaBroker],
	retry: {
		retries: 0
	}
})

const producer = kafka.producer()
// End

// Send tracking message to Kafka
async function sendTrackingMessage(data) {
	//Ensure the producer is connected
	await producer.connect()

	//Send message
	let result = await producer.send({
		topic: options.kafkaTopicTracking,
		messages: [
			{ value: JSON.stringify(data) }
		]
	})

	console.log("Send result:", result)
	return result
}
// End

// -------------------------------------------------------
// HTML helper to send a response to the client
// -------------------------------------------------------
const path = require('path');
app.use(express.static(path.join(__dirname)));
function sendResponse(res, html, cachedResult) {
	res.send(`<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Big Data Use-Case Demo</title>
			<link rel="stylesheet" href="./stylesheet.css">
		</head>
		<body>
			<h1>BookBloom</h1>

			${html}

		</body>
	</html>
	`)
}

// -------------------------------------------------------
// Start page
// -------------------------------------------------------

// Get list of books (from cache or db)
async function getMissions() {
	const key = 'books'
	let cachedata = await getFromCache(key)

	if (cachedata) {
		console.log(`Cache hit for key=${key}, cachedata = `, cachedata)
		return { result: cachedata, cached: true }
	} else {
		console.log(`Cache miss for key=${key}, querying database`)
		const data = await executeQuery("SELECT title, img FROM books", [])
		if (data) {
			let result = data.map(row => ({ title: row?.[0], img: row?.[1] }))
			console.log("Got result=", result, "storing in cache")
			if (memcached)
				await memcached.set(key, result, cacheTimeSecs);
			return { result, cached: false }
		} else {
			throw "No books data found"
		}
	}
}

// Get popular books (from db only)
async function getPopular(maxCount) {
	const query = "SELECT title, count FROM popular WHERE title <> 'stylesheet.css' ORDER BY count DESC LIMIT ?"
	return (await executeQuery(query, [maxCount]))
		.map(row => ({ title: row?.[0], count: row?.[1] }))
}

// Get unpopular books (from db only)
async function getUnpopular(maxCount) {
	const query = "SELECT title, count FROM popular WHERE title <> 'stylesheet.css' ORDER BY count ASC LIMIT ?"
	return (await executeQuery(query, [maxCount]))
		.map(row => ({ title: row?.[0], count: row?.[1] }))
}

// Return HTML for start page
app.get("/", (req, res) => {
	const topX = 5;
	Promise.all([getMissions(), getPopular(topX), getUnpopular(topX)]).then(values => {
		const books = values[0]
		const popular = values[1]
		const unpopular = values[2]
		const missionsHtml = books.result
			.map(m => `
			<a href='books/${m.title}' class="book-grid">
				<img src=${m.img} alt='${m.title}' />
			</a>
			`)
			.join(" ");
			

		const popularHtml = popular
			.map(pop => `<li> <a href='books/${pop.title}'>${pop.title.replace(/_/g, ' ')}</a> (${pop.count} views) </li>`)
			.join("\n")

		const unpopularHtml = unpopular
			.map(unpop => `<li> <a href='books/${unpop.title}'>${unpop.title.replace(/_/g, ' ')}</a> (${unpop.count} views) </li>`)
			.join("\n")
			
		const html = `
			<h1>Favorite ${topX} books</h1>		
			<p>
				<ol style="margin-left: 2em;"> ${popularHtml} </ol> 
			</p>			
			<h1>Least Favorite ${topX} books</h1>		
			<p>
				<ol style="margin-left: 2em;"> ${unpopularHtml} </ol> 
			</p>
			<h1>All books</h1>
			<p href=>${missionsHtml}</p>
		`
		sendResponse(res, html, books.cached)
	})
})

// -------------------------------------------------------
// Get a specific title (from cache or DB)
// -------------------------------------------------------

async function getMission(title) {
	const query = "SELECT title, heading, description FROM books WHERE title = ?"
	const key = 'mission_' + title
	let cachedata = await getFromCache(key);

	if (cachedata) {
		console.log(`Cache hit for key=${key}, cachedata = ${cachedata}`)
		return { ...cachedata, cached: true }
	} else {
		console.log(`Cache miss for key=${key}, querying database`)

		let data = (await executeQuery(query, [title]))?.[0] // first entry
		if (data) {
			let result = { title: data?.[0], heading: data?.[1], description: data?.[2] }
			console.log(`Got result=${result}, storing in cache`)
			if (memcached)
				await memcached.set(key, result, cacheTimeSecs);
			return { ...result, cached: false }
		} else {
			throw "No data found for this title"
		}
	}
}

app.get("/books/:title", (req, res) => {
	let title = req.params["title"]

	// Send the tracking message to Kafka
	sendTrackingMessage({
		title,
		timestamp: Math.floor(new Date() / 1000)
	}).then(() => console.log(`Sent title=${title} to kafka topic=${options.kafkaTopicTracking}`))
		.catch(e => console.log("Error sending to kafka", e))

	// Send reply to browser
	getMission(title).then(data => {
		sendResponse(res, `<h1 style="font-size: 40px; font-weight: bold; color: lightblue; font-family: Arial">${data.title.replace(/_/g, ' ')}</h1><p style= "font-size: 30px;
		font-weight: bold; color: #333; font-family: Arial""> Von: ${data.heading}</p>` +
			data.description.split("\n").map(p => `<p style="font-size: 30px; color: #555; margin-bottom: 10px; font-family:Arial">${p}</p>`).join("\n"),
			data.cached
		)
	}).catch(err => {
		sendResponse(res, `<h1>Error</h1><p>${err}</p>`, false)
	})
});

// -------------------------------------------------------
// Main method
// -------------------------------------------------------

app.listen(options.port, function () {
	console.log("Node app is running at http://localhost:" + options.port)
});
