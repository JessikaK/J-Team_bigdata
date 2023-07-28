# Use Case: Popular Book suggestions via BookBloom

Projekt erstellt von: 5222965, 4681952, 1419076, 3017015

## Use Case
Unser Use Case ist eine Buchdatenbank, an die eine Webanwendung angeschlossen ist. In dieser werden alle Bücher mit Titel und Cover angezeigt. Klickt man auf ein Buch, gelangt man auf die entsprechende Unterseite, auf der die Beschreibung und der Autor des ausgewählten Buches angezeigt werden. Basierend auf der Anzahl der Aufrufe der einzelnen Bücher gibt es auf der Startseite eine Top-5-Liste der am meisten aufgerufenen Bücher und eine Top-5-Liste der am wenigsten aufgerufenen Bücher. Beide Listen werden automatisch aktualisiert. So kann die Funktion demonstriert werden.

## Architektur
Unsere Anwendung kann über einen Internetbrowser aufgerufen werden. Hier kann der Benutzer mit der Webanwendung interagieren. Die HTTP-Anfragen werden an den Load Balancer gesendet. Dieser verteilt den eingehenden Traffic auf mehrere Instanzen von Webservern, um eine optimale Performance zu gewährleisten. So wird beispielsweise eine Überlastung des Servers verhindert. Dazu verwenden wir Kubernetes, das sich um die Orchestrierung der Container kümmert. Die Web Services verarbeiten dann die Benutzeranfragen. Hier findet die Kommunikation mit den Cache- und Datenbankservern statt, um die entsprechenden Benutzeranfragen auszuführen. Dies wird in unserem Fall durch die Node-Applikation (index.js) realisiert.  

Der Cache-Server (Memcache) speichert Daten, auf die häufig zugegriffen werden, im Speicher. Dadurch wird der Datenbankserver entlastet und die Antwortzeiten verbessert. Bei jeder Datenanfrage wird geprüft, ob diese Daten im Cache vorhanden sind. Ist dies der Fall, können die Daten direkt zur Verfügung gestellt werden, ohne dass sie extra aus der Datenbank geholt werden müssen. 

Der MySQL-Datenbankserver ist der Hauptspeicher der Daten. In unserem Fall werden hier die Informationen über die Bücher gespeichert. Folgende Attribute werden gespeichert: der Titel, eine Kurzbeschreibung des Buches und ein Autor. Im Gegensatz zum Cache-Server werden hier also die Daten gespeichert, die dauerhaft gespeichert werden sollen. 

Kafka ermöglicht es den verschiedenen Komponenten unserer Architektur in Echtzeit zu kommunizieren und Daten auszutauschen. Der Webserver kann bestimmte Ereignisse an Kafka senden, auf die dann andere Dienste wie Spark zugreifen können. 

Spark ist eine verteilte Datenverarbeitungs-Engine, die große Datenmengen effizient verarbeiten kann. Sie kann Daten aus dem Hadoop Distributed File System (HDFS) lesen und in dieses zurückschreiben.

In unserem Projekt nutzen wir eine Lambda-Architektur. Diese besteht aus drei Teilen, dem Batch Layer, dem Serving Layer und dem Speed Layer. Die eingehenden Daten werden hierbei parallel sowohl im Batch Layer, als auch im Speed Layer verarbeitet. Der Batch Layer aktualisiert die Daten in sogenannten Batches. Diese werden in regelmäßigen Intervallen ausgegeben. In unserem Fall geschieht das ungefähr jede Minute. Im Speed Layer werden die Daten wiederum in Echtzeit verarbeiten und somit die Sichten auch sofort aktualisiert. Der Serving Layer dient hier lediglich als Vermittler und sorgt für eine vereinheitlichte Ansicht der Daten auf Abfrageebene. 

## Entwurf und Design
Unsere Web App zeigt mehrere Bücher mit ihren Covern an, über die man wenn man auf diese klickt weitere Informationen zu diesen angezeigt bekommen kann. Dazu werden in zwei Listen die fünf belibtesten und die fünf unbeliebtesten Bücher bzw. die am meisten und am wenigsten angeklickten Bücher angezeigt.

Als Grundlage für unser Projekt haben wir die zur Verfügung gestellte Ordnerstruktur verwendet. Abgesehen von den anwendungsspezifischen Anforderungen haben wir folgende Änderungen an den folgenden Dateien vorgenommen: 

Mariadb.yaml: In unserer Datenbank sind in einer Tabelle "books" zwölf Bücher mit Titel, Kurzbeschreibung, Autor und Buchcover gespeichert. Als Primärschlüssel haben wir den Titel des jeweiligen Buches verwendet. Zusätzlich gibt es eine weitere Tabelle "Popular", in der die Anzahl der Klicks auf die einzelnen Bücher gespeichert ist.

index.js: In der eigentlichen Node-App haben wir die Attributnamen in den jeweiligen Funktionen an unsere Datenbank angepasst. Dazu haben wir einige Befehle geändert, die besser zu unserem Use Case passen. Damit die Informationen über die Bücher aufgerufen werden können, haben wir die Links unter die Buchcovers gepackt. Zusätzlich können die Buchinformationen auch über die beiden Listen favorite books und least favorite books aufgerufen werden. Dazu mussten wir noch einen Befehl hinzugefügen, damit der Buchtitel auch als Link zu weiteren Informationen dienen kann. Dafür haben wir die Leerzeichen in dem Primär Schlüssel Titel durch Unterstriche ersetzt, damit sie als Link übernommen werden können und die Unterstriche danach wieder zurück gessetzt, damit sie nicht angezeigt werden.

Die Datei generate_insert_statements.js und den auf der Web App abgebildeten Teil zu den Informationen der Seite haben wir gelöscht, da wir sie für dieses Projekt nicht gebraucht wurde. 

Dazu haben wir noch das stylesheet (.css) ausgetauscht und dieses im Dockerfile hinzugefügt, um die Web App etwas zu gestalten. 

## Screencast

## Vorraussetungen und Bereitstellung
Ein leistungsstarker Laptop/Pc

Für Docker Desktop muss ggfs. mehr Arbeitsspeicher eingestellt werden. Dies kann bei einem Macbook einfach über den Docker Desktop umgestellt werden, bei Windows muss dies über eine extra Datei eingerichtet werden.

Ein laufender Strimzi.io Kafka-Operator
bash
helm repo add strimzi http://strimzi.io/charts/
helm install my-kafka-operator strimzi/strimzi-kafka-operator
kubectl apply -f https://farberg.de/talks/big-data/code/helm-kafka-operator/kafka-cluster-def.yaml


Ein laufender Hadoop-Cluster mit YARN (für Checkpointing)
bash
helm repo add pfisterer-hadoop https://pfisterer.github.io/apache-hadoop-helm/
helm install --namespace=default --set hdfs.dataNode.replicas=1 --set yarn.nodeManager.replicas=1 --set hdfs.webhdfs.enabled=true my-hadoop-cluster pfisterer-hadoop/hadoop


Beim Starten von Minikube muss diesem mehr Arbeitsspeicher zugeteilt werden, damit die Web App richtig starten kann. Das kann mit dem Befehl `Minikube start driver=docker memory=6GB` ereicht werden.


Zum Starten mit [Skaffold](https://skaffold.dev/), muss der Befehl `skaffold dev` genutzt werden. Wenn die App hochgefahren ist kann in einer neuen Shell mit dem Befehl `minikube service popular-slides-service` die Web App aufgerufen werden.
