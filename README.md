# Chess Arena Backend

## Overview
The Chess Arena Backend is responsible for managing the chess game logic, handling user connections via WebSockets, and providing API endpoints for interaction with the front end. This document outlines the architecture of the backend, API endpoints, Socket.IO events, database setup, environment variables, and deployment instructions.

## Architecture
- The backend is built with Node.js and Express.
- WebSocket connections are established using Socket.IO to facilitate real-time communication between players.
- The database is managed using Supabase, which provides a Postgres database and various services for authentication and file storage.

## API Endpoints
| Method | Endpoint                | Description                             |
|--------|------------------------|-----------------------------------------|
| GET    | `/api/games`           | Retrieve all games                      |
| POST   | `/api/games`           | Create a new game                       |
| GET    | `/api/games/:id`       | Get game by ID                         |
| PUT    | `/api/games/:id`       | Update game by ID                      |
| DELETE | `/api/games/:id`       | Delete game by ID                      |
| POST   | `/api/users/register`   | Register a new user                    |
| POST   | `/api/users/login`      | Authenticate a user                     |
| GET    | `/api/users/:id`       | Get user by ID                        |

## Socket.IO Events
- **`game:join`**: Emitted when a player joins a game.
- **`game:move`**: Emitted to communicate a player’s move.
- **`game:end`**: Emitted when a game ends.
- **`user:connect`**: Emitted when a user connects to the server.

## Database Setup with Supabase
1. Create a Supabase account and a new project.
2. Set up database tables for users and games following the schema defined in the migrations.
3. Configure authentication using Supabase's built-in auth features.

## Environment Variables Configuration
Create a `.env` file in the root of the project with the following keys:
- `SUPABASE_URL`: Your Supabase project URL.
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key.
- `PORT`: The port on which the application will run.

## Running Locally
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/chess-arena-backend.git
   cd chess-arena-backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the application:
   ```bash
   npm start
   ```
4. Visit `http://localhost:PORT` in your browser.

## Deployment Instructions for Railway
1. Go to Railway.app and create a new project.
2. Connect your GitHub repository.
3. Set the environment variables in the Railway dashboard.
4. Deploy the project and Railway will automatically install dependencies and start your server.

## Testing Procedures
- To run the tests, use the following command:
  ```bash
  npm test
  ```
- Ensure you have set up a test database and configured the relevant environment variables for testing. 

## Conclusion
This README provides a comprehensive overview of the Chess Arena Backend project. Ensure that you follow the instructions carefully to set up and run the project successfully.