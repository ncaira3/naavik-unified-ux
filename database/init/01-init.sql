-- Initialize Naavik Demo Database
-- This runs automatically when the container starts

\echo 'Creating Naavik Demo Database...'

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

\echo 'Extensions created successfully!'
