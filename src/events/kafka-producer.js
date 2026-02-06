const { Kafka, logLevel } = require('kafkajs');
const config = require('../config');

let kafka = null;
let producer = null;

const getKafka = () => {
  if (!kafka) {
    kafka = new Kafka({
      clientId: config.KAFKA_CLIENT_ID,
      brokers: config.KAFKA_BROKERS,
      logLevel: config.NODE_ENV === 'production' ? logLevel.ERROR : logLevel.WARN,
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
  }
  return kafka;
};

const getProducer = async () => {
  if (!producer) {
    producer = getKafka().producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000
    });
    await producer.connect();
    console.log('Kafka producer connected');
  }
  return producer;
};

const publishEvent = async (topic, key, value) => {
  const prod = await getProducer();
  await prod.send({
    topic,
    messages: [
      {
        key: key?.toString(),
        value: JSON.stringify(value),
        timestamp: Date.now().toString()
      }
    ]
  });
};

const disconnectProducer = async () => {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
};

module.exports = {
  getKafka,
  getProducer,
  publishEvent,
  disconnectProducer
};
