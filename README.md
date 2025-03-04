# Zapier-Radicale Bridge

A secure bridge service that connects Zapier with a Radicale CalDAV/CardDAV server, enabling automated calendar and contact management.

## Features

- Calendar event creation and management
- Contact management with detailed information
- Automatic contact creation from event participants
- Meeting-contact linking
- Rate limiting and security measures
- Docker Compose deployment with Caddy for automatic HTTPS
- API key authentication

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Prerequisites

- Docker and Docker Compose installed on your server
- A domain name pointing to your server
- Ports 80 and 443 available on your server
- Radicale server (included in Docker Compose setup)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/bebraveronline/zapier-caldav-bridge.git
cd zapier-radicale-bridge
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

# Domain Configuration
DOMAIN=your-domain.com
```

The `API_KEY` is a crucial security measure that acts as a shared secret between your API and Zapier. This key:
- Must be generated securely (use the provided openssl command)
- Must be kept private and never shared publicly
- Is required in the X-API-Key header for all API requests
- Prevents unauthorized access to your calendar and contacts
- Should be rotated periodically for enhanced security

4. Create required directories:
```bash
mkdir -p logs/caddy
```

5. Deploy using Docker Compose:
```bash
docker compose -f docker-compose.prod.yml up -d
```

## Security Configuration

1. Generate a secure API key:
```bash
openssl rand -base64 32
```

2. Update the API key in your `.env` file
3. Configure Radicale authentication (recommended for production)

## SSL/HTTPS

Caddy automatically handles SSL/HTTPS certificates through Let's Encrypt:
- Certificates are automatically obtained and renewed
- All HTTP traffic is automatically redirected to HTTPS
- Modern TLS configuration is enabled by default
- Certificates are stored in the `caddy_data` volume

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

The `createContact` flag will automatically create contact entries for all participants.

### Contacts

#### Create Contact
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

## Integration Features

### Event-Contact Integration
- Automatic contact creation from event participants
- Meeting linking to contacts
- Contact synchronization with calendar events
- Participant tracking and management

### Contact Management
- Separate first and last name fields
- Multiple phone number support (work and mobile)
- Next meeting tracking
- Notes and additional information storage
- Organization affiliation

### Calendar Features
- Comprehensive event details
- Participant management
- Location tracking
- Notes and description fields
- Automatic contact synchronization

## Technologies Used

### Backend
- **Node.js**: Server runtime environment
- **Express.js**: Web application framework
- **Zod**: Schema validation and type checking
- **node-fetch**: HTTP client for API requests
- **ical.js**: iCalendar format handling
- **vcard4**: vCard format handling
- **dotenv**: Environment configuration
- **cors**: Cross-origin resource sharing
- **helmet**: Security middleware
- **express-rate-limit**: Rate limiting

### Calendar/Contact Standards
- **iCalendar (RFC 5545)**: Calendar data format
- **vCard 4.0 (RFC 6350)**: Contact data format
- **CalDAV**: Calendar synchronization protocol
- **CardDAV**: Contact synchronization protocol

### Security
- **API Key Authentication**: Request validation
- **Rate Limiting**: DDoS protection
- **CORS**: Cross-origin security
- **Helmet**: HTTP header security
- **HTTPS**: TLS encryption

### Infrastructure
- **Docker**: Containerization
- **Docker Compose**: Multi-container orchestration
- **Caddy**: Web server and reverse proxy
  - Automatic HTTPS
  - Let's Encrypt integration
  - Modern TLS configuration
- **Radicale**: CalDAV/CardDAV server

### Development Tools
- **TypeScript**: Type safety and development experience
- **ESLint**: Code quality and consistency
- **Prettier**: Code formatting
- **nodemon**: Development auto-reload

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

## Support

For issues and feature requests, please open an issue in the repository.
