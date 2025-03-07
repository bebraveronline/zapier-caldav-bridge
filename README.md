# Zapier-Radicale Bridge

A secure bridge service that connects Zapier with a Radicale CalDAV/CardDAV server, enabling automated calendar and contact management.

## Features

- Calendar event creation via Zapier
- Contact management integration
- Rate limiting and security measures
- Docker Compose deployment with Caddy for automatic HTTPS
- API key authentication

## Prerequisites

- Docker and Docker Compose installed on your server
- A domain name pointing to your server
- Ports 80 and 443 available on your server
- Radicale server (included in Docker Compose setup)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/bebraveronline/zapier-caldav-bridge
cd zapier-caldav-bridge
```

2. Create a `.env` file:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`:

First, generate a secure API key using the following command:
```bash
# This command generates a secure 32-byte random string encoded in base64
# Example output: rM+Lqz1Cm5YKF3pbH+EEfJ6y8SvYrK1BzYt3P6IkUeM=
openssl rand -base64 32
```

Then update your `.env` file with the generated key and other settings:
```
NODE_ENV=production
PORT=3000

# Security
# Replace this with your generated API key from the openssl command above
API_KEY=your-generated-api-key-here

# Service URLs
RADICALE_URL=http://radicale:5232

# Radicale Authentication
RADICALE_AUTH_TYPE=htpasswd
RADICALE_HTPASSWD_FILENAME=/data/users
RADICALE_HTPASSWD_ENCRYPTION=bcrypt

# Domain Configuration
DOMAIN=your-domain.com
```

The `API_KEY` is a crucial security measure that acts as a shared secret between your API and Zapier. This key:
- Must be generated securely (use the provided openssl command)
- Must be kept private and never shared publicly
- Is required in the X-API-Key header for all API requests
- Prevents unauthorized access to your calendar and contacts
- Should be rotated periodically for enhanced security

To configure this key in Zapier:
1. Log in to [Zapier](https://zapier.com)
2. Create a new Zap
3. Choose "Webhooks by Zapier" as your action
4. Select "Custom Request"
5. In the "Custom Request" configuration:
   - Set your URL (e.g., `https://your-domain.com/api/events`)
   - Add a header named `X-API-Key` with your generated API key
   - Add another header `Content-Type: application/json`
   - Set the request method to POST
   - Configure the request body according to the API documentation below

4. Create required directories:
```bash
mkdir -p logs/caddy
```

5. Set up Radicale authentication (required for production):

Create a password file for Radicale:
```bash
# Install htpasswd utility (if not already installed)
# For Ubuntu/Debian:
apt-get install apache2-utils
# For Alpine Linux:
apk add apache2-utils

# Create the users directory
mkdir -p data/users

# Create a new user (replace 'username' with desired username)
htpasswd -B -c data/users username
```

6. Deploy using Docker Compose:
```bash
docker compose -f docker-compose.prod.yml up -d
```

## Security Configuration

1. Generate a secure API key:
```bash
openssl rand -base64 32
```

2. Update the API key in your `.env` file

3. Radicale Authentication:
   - Production setup uses `htpasswd` authentication by default
   - User credentials are stored in `/data/users` within the container
   - Uses bcrypt encryption for passwords
   - Create new users using the `htpasswd` command as shown above

## SSL/HTTPS

Caddy automatically handles SSL/HTTPS certificates through Let's Encrypt:
- Certificates are automatically obtained and renewed
- All HTTP traffic is automatically redirected to HTTPS
- Modern TLS configuration is enabled by default
- Certificates are stored in the `caddy_data` volume

## Zapier Integration

### 1. Create a Zapier Account
- Sign up at [zapier.com](https://zapier.com)
- Navigate to "My Apps" → "Build a Connection"

### 2. Configure Webhook Action

#### For Calendar Events:
- **Endpoint**: `https://your-domain.com/api/events`
- **Method**: POST
- **Headers**:
  - `Content-Type: application/json`
  - `X-API-Key: your-api-key-here`
- **Body Format**:
```json
{
  "summary": "Event Title",
  "description": "Event Description",
  "startDate": "2024-03-15T10:00:00Z",
  "endDate": "2024-03-15T11:00:00Z",
  "location": "Optional Location",
  "participants": [
    {
      "email": "participant@example.com",
      "name": "Participant Name"
    }
  ],
  "notes": "Additional notes about the event",
  "createContact": true
}
```

#### For Contacts:
- **Endpoint**: `https://your-domain.com/api/contacts`
- **Method**: POST
- **Headers**:
  - `Content-Type: application/json`
  - `X-API-Key: your-api-key-here`
- **Body Format**:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "mobilePhone": "+1987654321",
  "organization": "Company Name",
  "nextMeeting": "2024-03-15T10:00:00Z",
  "notes": "Important contact notes"
}
```

## API Documentation

### Calendar Events

#### Create Event
```http
POST /api/events
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "summary": "Meeting with Client",
  "description": "Quarterly Review",
  "startDate": "2024-03-15T10:00:00Z",
  "endDate": "2024-03-15T11:00:00Z",
  "location": "Conference Room A",
  "participants": [
    {
      "email": "client@example.com",
      "name": "John Smith"
    }
  ],
  "notes": "Prepare Q1 reports",
  "createContact": true
}
```

The response includes subscription URLs for the calendar:
```json
{
  "message": "Event created successfully",
  "event": { ... },
  "subscriptionUrls": {
    "full": "/calendar/event-id/full.ics",
    "freebusy": "/calendar/event-id/freebusy.ics"
  }
}
```

### Calendar Subscriptions

#### Full Calendar (Authenticated)
```http
GET /calendar/:calendarId/full.ics
X-API-Key: your-api-key-here
```
Returns the full calendar in iCalendar format with complete event details. Requires authentication.

#### Free/Busy Calendar (Public)
```http
GET /calendar/:calendarId/freebusy.ics
```
Returns the calendar's free/busy information in iCalendar format. No authentication required.

### Create Contact

```http
POST /api/contacts
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "mobilePhone": "+1987654321",
  "organization": "Tech Corp",
  "nextMeeting": "2024-03-15T10:00:00Z",
  "notes": "Key client contact"
}
```

## Rate Limiting

- 100 requests per IP address per 15 minutes
- Rate limit headers included in responses
- Configurable in `docker-compose.yml`

## Production Recommendations

1. **Monitoring**:
   - Set up logging with a service like ELK Stack
   - Monitor system resources and API usage
   - Check Caddy logs in `logs/caddy/access.log`

2. **Backup**:
   - Regular backups of Radicale data volume
   - Backup Caddy data volume for SSL certificates
   - Implement backup rotation strategy

3. **Security**:
   - Keep API keys secure and rotate them periodically
   - Regular security updates
   - Enable Radicale authentication
   - Monitor Caddy logs for security issues
   - Use strong, unique API keys for each integration
   - Store API keys securely in password managers

## Troubleshooting

Common issues and solutions:

1. **Rate Limit Exceeded**:
   - Check rate limit headers in response
   - Adjust limits in configuration if needed

2. **Authentication Failed**:
   - Verify API key in headers matches .env file
   - Check for typos in key
   - Ensure key is being sent in X-API-Key header
   - Verify key hasn't been rotated recently

3. **SSL/HTTPS Issues**:
   - Ensure domain DNS is properly configured
   - Check Caddy logs for certificate issues
   - Verify ports 80 and 443 are accessible

4. **Connection Issues**:
   - Verify Radicale service is running
   - Check network connectivity
   - Validate URLs in configuration

5. **Radicale Authentication Issues**:
   - Verify htpasswd file exists and is properly formatted
   - Check user permissions on the htpasswd file
   - Ensure bcrypt encryption is being used
   - Validate username/password combinations

## Technologies Used

- **Backend**:
  - Node.js with Express for the API server
  - Zod for request validation
  - Express Rate Limit for API protection
  - Helmet for security headers
  - CORS for cross-origin resource sharing

- **Calendar/Contacts Server**:
  - Radicale for CalDAV/CardDAV support (xlrl/radicale)
  - iCal.js for calendar data parsing
  - vCard4 for contact data handling

- **Infrastructure**:
  - Docker and Docker Compose for containerization
  - Caddy for reverse proxy and automatic HTTPS
  - Let's Encrypt for SSL certificates

- **Security**:
  - API key authentication
  - Rate limiting
  - HTTPS encryption
  - Security headers
  - Input validation

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

For issues and feature requests, please open an issue in the repository.