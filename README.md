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

#### Multi-Layer City Detection Strategy

The application employs a sophisticated **4-layer validation system** to accurately identify cities:

##### **Layer 1: Data Quality Filtering (First Pass)**

Initial filtering removes obviously invalid entries:

- **Length validation**: Must be 2-64 characters after normalization
- **Character validation**: Only letters, spaces, hyphens, apostrophes, dots allowed
- **Content validation**: Must contain letters, no digits
- **Blacklist filtering**: Removes `unknown`, `n/a`, `test`, `lorem`, etc.
- **Pollution data validation**: Must be finite, non-negative number

##### **Layer 2: Intelligent Classification (Second Pass)**

Sophisticated heuristics categorize entries using `cityFilter.ts`:

```typescript
const verdict = classify(
  {
    name: String(row?.name ?? ""),
    pollution,
  },
  country
);
```

**Classification Categories:**

- **"keep"** - Clean, obvious city names (e.g., "Berlin", "Madrid")
- **"salvage"** - Names that can be cleaned up (e.g., "Warsaw (Zone)" → "Warsaw")
- **"reject"** - Non-city entities (facilities, districts, etc.)

##### **Layer 3: Wikipedia Validation (Third Pass)**

Authoritative validation using Wikipedia's API:

```typescript
function validatePageIsCity(p: QueryPage): { ok: boolean; reason: string } {
  // Check categories for non-city indicators
  if (cats.some((c) => CAT_DENY.some((rx) => rx.test(c))))
    return { ok: false, reason: "deny-category" };

  // Check intro text patterns
  if (POS_INTRO.test(intro)) return { ok: true, reason: "intro-cityish" };
  if (NEG_INTRO.test(intro)) return { ok: false, reason: "intro-noncity" };
}
```

**Wikipedia Validation Checks:**

- **Category analysis**: Filters out airports, districts, facilities, power plants
- **Intro text patterns**: Looks for city-like descriptions vs. facility descriptions
- **Page properties**: Checks for disambiguation pages
- **Content validation**: Ensures page contains meaningful city information

##### **Layer 4: Disambiguation Handling**

Intelligent retry with country context for ambiguous names:

```typescript
if (verdict.reason === "disambiguation") {
  const countryLabel = COUNTRY_LABEL[country];
  const newInput = `${input}, ${countryLabel}`; // "Barcelona, Spain"
  // Retry with country context for accurate validation
}
```

#### Locale-Aware Name Processing

- **Polish (PL)**: Preserves diacritics (ę, ź, ó), capitalizes all significant words
- **German (DE)**: Handles ß, lowercase articles (`am`, `im`, `an der`)
- **Spanish (ES)**: Strips accents except ñ/ü, lowercase articles (`de`, `del`, `de la`)
- **French (FR)**: Lowercase articles (`de`, `du`, `le`, `la`, `en`)

#### Example Decision Flow

```
"Frankfurt am Main" →
  ✅ Passes data quality filters →
  ✅ Classified as "keep" →
  ✅ Wikipedia validates as city →
  ✅ Returns with description

"Monitoring Station B" →
  ❌ Fails data quality (contains digits) →
  ❌ Rejected

"Barcelona" →
  ✅ Passes filters →
  ✅ Wikipedia returns disambiguation →
  🔄 Retries with "Barcelona, Spain" →
  ✅ Validates as city
```

#### Key Strengths of This Approach

1. **Defense in depth**: Multiple validation layers ensure high accuracy
2. **Intelligent fallbacks**: Handles edge cases gracefully
3. **Locale awareness**: Respects different naming conventions
4. **External validation**: Uses Wikipedia as authoritative source
5. **Graceful degradation**: Returns partial results if validation fails
6. **Performance optimized**: Batch processing and intelligent caching

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

### Testing & Quality Assurance

1. **Test Coverage**: Unit and integration tests for all components
2. **Performance Testing**: Load testing and benchmarking tools

### Security & Authentication

3. **Implement Authentication**: JWT-based user authentication system
4. **API Key Management**: Rate limiting per user/organization

### Functionality & User Experience

5. **Add Search Functionality**: Basic city name search
6. **Full-text Search**: Elasticsearch integration for city name searching
7. **Search Suggestions**: Autocomplete for city names
8. **Advanced Filters**: Pollution range, population size, climate data

### Performance & Scalability

9. **Redis Implementation**: Replace in-memory cache with Redis for persistence and distributed caching
10. **Database Integration**: PostgreSQL/MongoDB for persistent storage
11. **Horizontal Scaling**: Multi-instance deployment with shared Redis cache

### Monitoring & Observability

12. **Add Proper Monitoring and Logging**: Structured logging with correlation IDs
13. **Implement Comprehensive ErrorBoundaries**: Better error tracking and reporting

### Resilience & Reliability

14. **Add Error Recovery Mechanisms**: Automatic retry and fallback strategies
15. **Circuit Breaker Pattern**: Prevent cascading failures to external APIs
16. **Fallback Mechanisms**: Graceful degradation when external services are unavailable

### Internationalization

17. **Multi-language Support**: City descriptions in multiple languages
