using Microsoft.Azure.Cosmos;

namespace TriviaChallenge.Api.Services;

/// <summary>
/// Service for managing Cosmos DB client and containers
/// </summary>
public class CosmosDbService
{
    private readonly CosmosClient _cosmosClient;
    private readonly Database _database;
    private readonly Container _usersContainer;
    private readonly Container _questionsContainer;
    private readonly Container _questionPoolsContainer;
    private readonly Container _questionDrawsContainer;
    private readonly Container _gameSessionsContainer;
    private readonly Container _gameSessionAnswersContainer;
    private readonly ILogger<CosmosDbService> _logger;

    public CosmosDbService(
        CosmosClient cosmosClient,
        string databaseName,
        string usersContainerName,
        string questionsContainerName,
        string questionPoolsContainerName,
        string questionDrawsContainerName,
        string gameSessionsContainerName,
        string gameSessionAnswersContainerName,
        ILogger<CosmosDbService> logger)
    {
        _cosmosClient = cosmosClient ?? throw new ArgumentNullException(nameof(cosmosClient));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));

        _database = _cosmosClient.GetDatabase(databaseName);
        _usersContainer = _database.GetContainer(usersContainerName);
        _questionsContainer = _database.GetContainer(questionsContainerName);
        _questionPoolsContainer = _database.GetContainer(questionPoolsContainerName);
        _questionDrawsContainer = _database.GetContainer(questionDrawsContainerName);
        _gameSessionsContainer = _database.GetContainer(gameSessionsContainerName);
        _gameSessionAnswersContainer = _database.GetContainer(gameSessionAnswersContainerName);

        _logger.LogInformation("CosmosDbService initialized with database: {DatabaseName}", databaseName);
    }

    /// <summary>
    /// Gets the Users container
    /// </summary>
    public Container UsersContainer => _usersContainer;

    /// <summary>
    /// Gets the Questions container
    /// </summary>
    public Container QuestionsContainer => _questionsContainer;

    /// <summary>
    /// Gets the QuestionPools container
    /// </summary>
    public Container QuestionPoolsContainer => _questionPoolsContainer;

    /// <summary>
    /// Gets the QuestionDraws container
    /// </summary>
    public Container QuestionDrawsContainer => _questionDrawsContainer;

    /// <summary>
    /// Gets the GameSessions container
    /// </summary>
    public Container GameSessionsContainer => _gameSessionsContainer;

    /// <summary>
    /// Gets the GameSessionAnswers container
    /// </summary>
    public Container GameSessionAnswersContainer => _gameSessionAnswersContainer;

    /// <summary>
    /// Gets the database for health check purposes
    /// </summary>
    public async Task<Database> GetDatabaseAsync(CancellationToken cancellationToken = default)
    {
        // Perform a simple read to verify connectivity
        await _database.ReadAsync(cancellationToken: cancellationToken);
        return _database;
    }

    /// <summary>
    /// Initializes the database and containers if they don't exist
    /// </summary>
    public async Task InitializeDatabaseAsync()
    {
        try
        {
            _logger.LogInformation("Initializing Cosmos DB database and containers...");

            // Create database if it doesn't exist
            DatabaseResponse databaseResponse = await _cosmosClient.CreateDatabaseIfNotExistsAsync(
                _database.Id,
                throughput: 400); // Use 400 RU/s for development

            _logger.LogInformation("Database {DatabaseId} ready. Status: {StatusCode}", 
                databaseResponse.Database.Id, 
                databaseResponse.StatusCode);

            // Create Users container with partition key on /id (email)
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _usersContainer.Id,
                    PartitionKeyPath = "/id",
                    UniqueKeyPolicy = new UniqueKeyPolicy
                    {
                        UniqueKeys = { new UniqueKey { Paths = { "/email" } } }
                    }
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _usersContainer.Id);

            // Create Questions container with partition key on /id and indexing for pools array
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _questionsContainer.Id,
                    PartitionKeyPath = "/id",
                    IndexingPolicy = new IndexingPolicy
                    {
                        IndexingMode = IndexingMode.Consistent,
                        Automatic = true,
                        IncludedPaths = 
                        { 
                            new IncludedPath { Path = "/*" },
                            new IncludedPath { Path = "/pools/*" }
                        }
                    }
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _questionsContainer.Id);

            // Create QuestionPools container with partition key on /id
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _questionPoolsContainer.Id,
                    PartitionKeyPath = "/id"
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _questionPoolsContainer.Id);

            // Create QuestionDraws container with partition key on /id (seed as string)
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _questionDrawsContainer.Id,
                    PartitionKeyPath = "/id"
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _questionDrawsContainer.Id);

            // Create GameSessions container with partition key on /userId
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _gameSessionsContainer.Id,
                    PartitionKeyPath = "/userId",
                    IndexingPolicy = new IndexingPolicy
                    {
                        IndexingMode = IndexingMode.Consistent,
                        Automatic = true,
                        IncludedPaths = { new IncludedPath { Path = "/*" } }
                    }
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _gameSessionsContainer.Id);

            // Create GameSessionAnswers container with partition key on /userId
            await _database.CreateContainerIfNotExistsAsync(
                new ContainerProperties
                {
                    Id = _gameSessionAnswersContainer.Id,
                    PartitionKeyPath = "/userId",
                    IndexingPolicy = new IndexingPolicy
                    {
                        IndexingMode = IndexingMode.Consistent,
                        Automatic = true,
                        IncludedPaths = { new IncludedPath { Path = "/*" } }
                    }
                },
                ThroughputProperties.CreateAutoscaleThroughput(1000));

            _logger.LogInformation("Container {ContainerId} ready", _gameSessionAnswersContainer.Id);

            _logger.LogInformation("Cosmos DB initialization completed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error initializing Cosmos DB");
            throw;
        }
    }
}
