# BookingGuru Cities API

A high-performance REST API that integrates pollution data with Wikipedia descriptions to return the most polluted cities by country. Features intelligent caching, rate limiting, and robust city name normalization.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev

# Production build
npm run build
npm start
```

Server runs on `http://localhost:3000` (or `PORT` environment variable)

## 📋 API Endpoints

### Get Most Polluted Cities

**`GET /api/v1/cities`**

Retrieves the most polluted cities for a specified country with Wikipedia descriptions.

#### Query Parameters

| Parameter | Type   | Required | Description                          | Default | Max |
| --------- | ------ | -------- | ------------------------------------ | ------- | --- |
| `country` | string | ✅       | Country code: `PL`, `DE`, `ES`, `FR` | -       | -   |
| `limit`   | number | ❌       | Number of cities to return           | 10      | 50  |

#### Response

```json
{
  "country": "ES",
  "limit": 3,
  "results": [
    {
      "country": "ES",
      "city": "Barcelona",
      "pollution": 89.5,
      "description": "Barcelona is a city on the coast of northeastern Spain..."
    },
    {
      "country": "ES",
      "city": "Madrid",
      "pollution": 87.2,
      "description": "Madrid is the capital and most populous city of Spain..."
    },
    {
      "country": "ES",
      "city": "Valencia",
      "pollution": 82.1,
      "description": "Valencia is the capital of the autonomous community of Valencia..."
    }
  ]
}
```

#### Error Responses

```json
// Invalid country
{
  "error": "Invalid or missing country. Use one of: PL, DE, ES, FR"
}

// Rate limit exceeded
{
  "message": "Rate limit exceeded after 3 attempts. API allows 5 requests per 10 seconds."
}
```

### Health Check

**`GET /api/v1/health`**

```json
{
  "ok": true
}
```

## 🏗️ Architecture

### Data Sources

1. **Pollution API**: `https://be-recruitment-task.onrender.com`

   - Provides paginated pollution data for cities
   - Requires authentication (`testuser` / `testpass`)
   - Rate limited: 5 requests per 10 seconds
   - Supports refresh tokens for extended sessions

2. **Wikipedia API**: `https://en.wikipedia.org/w/api.php`
   - Fetches city descriptions and validates city status
   - Handles disambiguation pages with country context
   - Batch processing for optimal performance

### Smart City Detection & Normalization

The application uses advanced heuristics to identify valid cities:

#### Validation Rules

- **Length**: 2-64 characters after normalization
- **Character set**: Letters, spaces, hyphens, apostrophes, dots only
- **Content**: Must contain letters, no digits
- **Blacklist**: Filters out `unknown`, `n/a`, `test`, etc.
- **Pollution data**: Must be finite, non-negative number

#### Locale-Aware Name Processing

- **Polish (PL)**: Preserves diacritics (ę, ź, ó), capitalizes all significant words
- **German (DE)**: Handles ß, lowercase articles (`am`, `im`, `an der`)
- **Spanish (ES)**: Strips accents except ñ/ü, lowercase articles (`de`, `del`, `de la`)
- **French (FR)**: Lowercase articles (`de`, `du`, `le`, `la`, `en`)

#### Wikipedia Integration

- Validates cities using categories and intro text patterns
- Handles disambiguation with country context (`"Barcelona, Spain"`)
- Filters out non-cities (airports, districts, facilities)

## 🚄 Performance & Caching

### Multi-Level LRU Cache System

1. **Pollution API Cache** (5 minutes TTL)

   - Caches raw API responses by country/page/limit
   - Respects rate limits and reduces API calls
   - LRU eviction with 500 item limit

2. **Wikipedia Description Cache** (24 hours TTL)

   - Long-term caching of city descriptions
   - Batch processing for optimal API usage
   - LRU eviction with 1000 item limit

3. **Progressive Country Cache** (2 hours TTL)
   - Stores processed city results incrementally
   - Supports smart pagination (reuses cached data)
   - LRU eviction with 50 country limit

### Smart Pagination Strategy

```javascript
// First request: limit=10
GET /api/v1/cities?country=ES&limit=10
// → Fetches pages 1-2, caches ~20 cities, returns top 10

// Second request: limit=20
GET /api/v1/cities?country=ES&limit=20
// → Uses cached 20 cities, no API calls needed

// Third request: limit=30
GET /api/v1/cities?country=ES&limit=30
// → Uses cached 20, fetches additional pages for remaining 10
```

### Rate Limiting & Retry Logic

- **Proactive rate limiting**: Tracks request windows (5 req/10s)
- **Exponential backoff**: 1s → 2s → 4s delays on 429 errors
- **Automatic retry**: Up to 3 attempts with intelligent delays
- **Token refresh**: Uses refresh tokens to minimize authentication calls

## 🛡️ Error Handling & Resilience

- **Graceful degradation**: Returns partial results if some data unavailable
- **Comprehensive error handling**: Detailed error messages and proper HTTP codes
- **Request validation**: Input sanitization and type checking
- **Timeout handling**: Prevents hanging requests
- **Memory management**: LRU eviction prevents memory leaks

## 🔧 Configuration

### Environment Variables

```env
NODE_ENV=development
PORT=3000
POLLU_API_USERNAME=testuser
POLLU_API_PASSWORD=testpass
```

### Cache Configuration

```typescript
// Configurable cache sizes and TTLs
const CACHE_CONFIG = {
  pollution: { size: 500, ttl: 5 * 60 * 1000 }, // 5 minutes
  wikipedia: { size: 1000, ttl: 24 * 60 * 60 * 1000 }, // 24 hours
  countries: { size: 50, ttl: 2 * 60 * 60 * 1000 }, // 2 hours
};
```

## 📊 Monitoring & Debugging

### Cache Statistics

The application provides cache performance metrics:

```typescript
// Access cache stats
const stats = cityService.getCacheStats();
console.log(stats);
// {
//   totalKeys: 1547,
//   pollutionKeys: 245,
//   wikiKeys: 1250,
//   countryKeys: 4
// }
```

### Logging

- Cache hit/miss ratios
- API rate limiting events
- Wikipedia disambiguation handling
- City classification decisions

## 🧪 Example Usage

```bash
# Get top 5 polluted cities in Poland
curl "http://localhost:3000/api/v1/cities?country=PL&limit=5"

# Get top 20 polluted cities in Germany
curl "http://localhost:3000/api/v1/cities?country=DE&limit=20"

# Health check
curl "http://localhost:3000/api/v1/health"
```

## 🏷️ Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **HTTP Client**: Axios with custom retry logic
- **Caching**: Custom LRU implementation
- **Text Processing**: Unicode normalization, locale-aware casing
- **Error Handling**: Custom error middleware with detailed logging

## 📝 Assumptions & Limitations

- **Supported countries**: Limited to PL, DE, ES, FR (API constraint)
- **City detection**: Uses heuristics; may occasionally misclassify edge cases
- **Cache persistence**: In-memory only; resets on application restart
- **Rate limits**: Bound by external API constraints (5 req/10s for pollution data)
- **Language**: Wikipedia descriptions are in English only
- **Data freshness**: Pollution data cached for 5 minutes, descriptions for 24 hours

## 🚀 Performance Characteristics

- **Cold start**: ~2-3s for first request (authentication + API calls)
- **Warm cache**: ~50-100ms for cached results
- **Memory usage**: ~10-50MB depending on cache size
- **Throughput**: Limited by external API rate limits, not application performance
- **Scalability**: Stateless design allows horizontal scaling (shared cache needed)

## 🔮 Future Enhancements

### 1. Test Coverage & Quality Assurance

- **Unit Tests**: Comprehensive testing of city classification, caching logic, and utility functions
- **Integration Tests**: End-to-end API testing with mocked external services
- **Performance Tests**: Load testing with tools like Artillery or k6
- **Contract Testing**: API contract validation with tools like Pact
- **Code Coverage**: Aim for 90%+ coverage with Istanbul/nyc

### 2. Authentication & Authorization

- **JWT-based Authentication**: Secure token-based user authentication
- **Role-based Access Control**: Different permission levels for different user types
- **API Key Management**: Rate limiting per user/organization
- **OAuth Integration**: Support for third-party authentication providers
- **Session Management**: Secure session handling with Redis

### 3. Advanced Search & Filtering

- **Full-text Search**: Elasticsearch integration for city name searching
- **Geographic Search**: Location-based queries with geospatial indexing
- **Advanced Filters**: Pollution range, population size, climate data
- **Fuzzy Matching**: Handle typos and partial city names
- **Search Suggestions**: Autocomplete for city names

### 4. Comprehensive Monitoring & Observability

- **Application Metrics**: Prometheus metrics for request rates, response times, error rates
- **Distributed Tracing**: OpenTelemetry integration for request flow tracking
- **Centralized Logging**: ELK stack (Elasticsearch, Logstash, Kibana) or similar
- **Health Checks**: Detailed health endpoints with dependency status
- **Alerting**: Proactive alerts for errors, high latency, or rate limit issues
- **Dashboard**: Grafana dashboards for real-time monitoring

### 5. Error Boundaries & Resilience

- **Circuit Breaker Pattern**: Prevent cascading failures to external APIs
- **Bulkhead Pattern**: Isolate different types of operations
- **Retry Policies**: Configurable retry strategies with exponential backoff
- **Fallback Mechanisms**: Graceful degradation when external services are unavailable
- **Dead Letter Queues**: Handle failed requests for later processing

### 6. Error Recovery & Self-healing

- **Automatic Recovery**: Self-healing mechanisms for transient failures
- **Cache Warming**: Proactive cache population during low-traffic periods
- **Health-based Routing**: Route requests away from unhealthy instances
- **Graceful Shutdown**: Handle in-flight requests during deployments
- **Rollback Mechanisms**: Automatic rollback on deployment failures

### 7. Performance Optimization

- **Database Integration**: PostgreSQL/MySQL for persistent storage and complex queries
- **Redis Clustering**: Distributed caching for horizontal scaling
- **CDN Integration**: Edge caching for static content and API responses
- **Response Compression**: Gzip/Brotli compression for large responses
- **Connection Pooling**: Optimize database and external API connections
- **Background Jobs**: Queue-based processing for heavy operations

### 8. Security Enhancements

- **Input Validation**: Comprehensive input sanitization and validation
- **Rate Limiting**: Advanced rate limiting with user-based quotas
- **CORS Configuration**: Proper cross-origin resource sharing setup
- **Security Headers**: Helmet.js integration for security headers
- **API Versioning**: Semantic versioning for backward compatibility
- **Audit Logging**: Track all API access and modifications

### 9. DevOps & Deployment

- **Containerization**: Docker containers for consistent deployment
- **CI/CD Pipeline**: Automated testing and deployment with GitHub Actions
- **Infrastructure as Code**: Terraform or CloudFormation for infrastructure
- **Blue-Green Deployments**: Zero-downtime deployment strategies
- **Environment Management**: Separate configs for dev, staging, production
- **Backup & Recovery**: Automated backup strategies and disaster recovery

### 10. Data & Analytics

- **Historical Data**: Store pollution trends over time
- **Data Export**: CSV/JSON export capabilities
- **Analytics Dashboard**: Insights into API usage and city data trends
- **Machine Learning**: Predict pollution levels based on historical data
- **Data Validation**: Automated data quality checks and anomaly detection
- **ETL Pipelines**: Automated data processing and transformation

### 11. API Enhancements

- **GraphQL Support**: Flexible querying for complex data requirements
- **WebSocket Support**: Real-time updates for pollution data changes
- **Bulk Operations**: Batch processing for multiple cities/countries
- **Webhook Support**: Notify external systems of data changes
- **API Documentation**: Interactive OpenAPI/Swagger documentation
- **SDK Generation**: Auto-generated client libraries for multiple languages

### 12. Internationalization & Localization

- **Multi-language Support**: City descriptions in multiple languages
- **Locale-specific Formatting**: Date, number, and currency formatting
- **Cultural Adaptations**: Country-specific data presentation
- **Translation Management**: Automated translation workflows
- **RTL Language Support**: Right-to-left language support

These enhancements would transform the current API into a production-ready, enterprise-grade system with comprehensive monitoring, security, and scalability features.
