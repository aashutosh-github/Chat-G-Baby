# Chat-G-Baby

An extensible Node.js backend for an authenticated AI chat application. It combines Gemini-powered responses with persistent conversations, MongoDB-backed user data, Redis rate limiting, token accounting, and automatic conversation summarization.

> This project is currently API-first: it exposes the backend services required by a chat client and does not include a frontend.

## Highlights

- **Gemini-powered conversations** through Google’s `@google/genai` Interactions API.
- **User accounts** with signup, login, profile, logout, and account deletion flows.
- **Secure password storage** using `bcrypt` hashing.
- **JWT authentication** stored in an HTTP-only cookie.
- **Blocked-token logout** using Redis, allowing logged-out JWTs to be rejected before expiry.
- **Per-IP request protection** for unauthenticated endpoints.
- **Per-user request protection** for authenticated endpoints.
- **AI token usage limits** backed by Redis, with configurable limits and expiry windows.
- **Persistent chat history** stored in MongoDB and scoped to the authenticated user.
- **Recent chat management**, including chat creation, retrieval, and deletion.
- **Context-aware AI requests** containing previous messages and optional summaries.
- **Automatic summarization** of longer conversations through the ScaleDown summarization API.
- **Request Locking**, only one request is processed at once, prevents rate limit abuse by sending multiple requests at the same time from different tabs
- **Usage tracking** at both the user and chat level.
- **MongoDB indexes** for common chat and message retrieval patterns.

## Architecture

```text
Client
  |
  v
Express routes
  |
  +--> Authentication and rate-limit middleware
  |
  +--> Controllers
          |
          +--> MongoDB: users, chats, messages
          +--> Redis: rate limits, token counters, blocked sessions
          +--> Gemini: response generation
          +--> ScaleDown: long-conversation summaries
```

### Repository layout

```text
config/        Database, Redis, and Gemini client configuration
controllers/   Request handlers for users, chats, and messages
middlewares/   Authentication, user loading, and rate limiting
model/         Mongoose schemas for users, chats, and messages
routes/        Express route definitions
service/       Gemini response generation and chat summarization
utils/         Context construction, usage tracking, and time formatting
validators/    Zod request validation schemas
index.js       Application entry point
```

## Prerequisites

- Node.js 18 or newer
- npm
- A MongoDB database (local or hosted)
- A Redis-compatible database (local or hosted)
- A Google Gemini API key
- A ScaleDown API key if you want automatic summarization after longer chats

## Run locally

### 1. Clone the repository

```bash
git clone https://github.com/aashutosh-github/AI_backend.git
cd AI_backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a local `.env` file in the project root. Never commit this file.

```env
# Server
PORT=3000

# MongoDB
MONGO_URL=mongodb://127.0.0.1:27017/ai_backend

# Authentication
JWT_SECRET=replace-with-a-long-random-secret

# Google Gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_STANDARD_MODEL=gemini-3.6-flash

# ScaleDown summarization
SCALEDOWN_API_KEY=your-scaledown-api-key

# Redis
REDIS_URL=redis://127.0.0.1:6379

# Maximum AI tokens allowed before limit resets
MAX_TOKEN_LIMIT=100000

# Redis token-window duration, expressed in hours
REDIS_TOKEN_LIMIT_HOURS=5
```

`REDIS_TOKEN_LIMIT_HOURS` is converted to seconds by the application:

```js
Number(process.env.REDIS_TOKEN_LIMIT_HOURS) * 60 * 60;
```

Use numeric values in `.env`; arithmetic expressions such as `1*60*60*5` are not evaluated by dotenv.

### 4. Start the server

```bash
node index.js
```

The server starts at `http://localhost:3000` by default and connects to MongoDB and Redis before listening for requests.

## Authentication model

After a successful login, the server sets a `token` HTTP-only cookie. Protected routes read that cookie automatically, so clients must preserve cookies between requests.

For browser clients, requests should include credentials:

```js
fetch("http://localhost:3000/user/profile", {
  credentials: "include",
});
```

For command-line testing with `curl`, use a cookie jar:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"alex@example.com","password":"ExamplePass1!"}' \
  http://localhost:3000/user/login
```

## API reference

All request bodies must be JSON. Protected endpoints require the login cookie.

### User endpoints

| Method   | Endpoint        | Auth | Description                                           |
| -------- | --------------- | ---- | ----------------------------------------------------- |
| `POST`   | `/user/signup`  | No   | Create a user account                                 |
| `POST`   | `/user/login`   | No   | Authenticate and set the JWT cookie                   |
| `GET`    | `/user/profile` | Yes  | Return the current user profile and token usage       |
| `POST`   | `/user/logout`  | Yes  | Clear the cookie and block the current token in Redis |
| `DELETE` | `/user/delete`  | Yes  | Delete the user and associated chats/messages         |

Signup example:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Alex Morgan",
    "age":28,
    "email":"alex@example.com",
    "password":"ExamplePass1!"
  }' \
  http://localhost:3000/user/signup
```

### Chat endpoints

| Method   | Endpoint        | Auth | Description                     |
| -------- | --------------- | ---- | ------------------------------- |
| `POST`   | `/chat/create`  | Yes  | Create an empty chat            |
| `GET`    | `/chat/recents` | Yes  | Return up to 20 recent chats    |
| `GET`    | `/chat/:chatId` | Yes  | Get a chat’s metadata and usage |
| `DELETE` | `/chat/:chatId` | Yes  | Delete a chat and its messages  |

### Message endpoints

| Method | Endpoint       | Auth | Description                                  |
| ------ | -------------- | ---- | -------------------------------------------- |
| `POST` | `/msg`         | Yes  | Create a new chat and send its first message |
| `POST` | `/msg/:chatId` | Yes  | Send a message in an existing chat           |
| `GET`  | `/msg/:chatId` | Yes  | Retrieve messages in a chat                  |

Send a message example:

```bash
curl -i -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"content":"Explain how Redis expiry works."}' \
  http://localhost:3000/msg
```

The response contains the generated output and the chat ID:

```json
{
  "output": "Redis expiry removes a key automatically after...",
  "chatId": "generated-mongodb-object-id"
}
```

## Request lifecycle

1. The request is authenticated using the JWT cookie.
2. Redis checks the relevant IP or user request limit.
3. The current user and requested chat are loaded from MongoDB.
4. Previous messages and any stored summary are converted into Gemini interaction steps.
5. Gemini generates the assistant response using the authenticated user’s profile metadata when relevant.
6. User and model messages are persisted in MongoDB.
7. Token usage is incremented in Redis and recorded on the user and chat documents.
8. Once enough messages accumulate, the conversation is summarized and the summary is stored for future context.

## Validation and limits

Signup currently validates:

- Name length between 3 and 30 characters
- Optional age between 10 and 100
- Valid email format
- Password length between 8 and 30 characters
- At least one uppercase letter, lowercase letter, number, and special character

The application also includes:

- 10 unauthenticated requests per IP per minute
- 20 authenticated requests per user per minute
- A configurable AI token limit per Redis expiry window
- Ownership checks so users cannot access or delete another user’s chats

## Troubleshooting

### The server does not start

Check that `MONGO_URL`, `REDIS_URL`, and `GEMINI_API_KEY` are present and that both databases are reachable.

### Redis expiry is not dynamic

Environment variables are strings. Store a numeric value such as `REDIS_TOKEN_LIMIT_HOURS=5`, which is then converted using JavaScript with `Number(...)`. Do not place expressions such as `1*60*60*5` directly in `.env`.
