const { GenericContainer, Wait, Network } = require('testcontainers');
const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const { RedisContainer } = require('@testcontainers/redis');
const { KafkaContainer } = require('@testcontainers/kafka');

let postgresContainer;
let redisContainer;
let kafkaContainer;
let network;

beforeAll(async () => {
  // Create a network for containers to communicate
  network = await new Network().start();

  // Start PostgreSQL
  postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .withDatabase('juber_db')
    .withUsername('juber')
    .withPassword('juber_secret')
    .withCopyFilesToContainer([{
      source: './scripts/init-db.sql',
      target: '/docker-entrypoint-initdb.d/init-db.sql'
    }])
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  // Start Redis
  redisContainer = await new RedisContainer('redis:7-alpine')
    .withNetwork(network)
    .withNetworkAliases('redis')
    .start();

  // Start Kafka
  kafkaContainer = await new KafkaContainer('confluentinc/cp-kafka:7.5.0')
    .withNetwork(network)
    .withNetworkAliases('kafka')
    .withExposedPorts(9093)
    .start();

  // Set environment variables for tests
  process.env.DATABASE_URL = postgresContainer.getConnectionUri();
  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getPort()}`;
  process.env.KAFKA_BROKERS = kafkaContainer.getBootstrapServers();
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Random port for tests
}, 120000);

afterAll(async () => {
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
  if (kafkaContainer) await kafkaContainer.stop();
  if (network) await network.stop();
});

module.exports = {
  getPostgresContainer: () => postgresContainer,
  getRedisContainer: () => redisContainer,
  getKafkaContainer: () => kafkaContainer
};
