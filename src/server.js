import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { z } from 'zod';
import fetch from 'node-fetch';

config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress ||
           '127.0.0.1';
  }
});
app.use(limiter);

// Validation schemas
const ParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().optional()
});

const EventSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string().optional(),
  participants: z.array(ParticipantSchema).optional(),
  notes: z.string().optional(),
  createContact: z.boolean().optional() // Flag to create contact from participant
});

const ContactSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
  organization: z.string().optional(),
  nextMeeting: z.string().optional(), // ISO date string
  notes: z.string().optional()
});

// API key middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
};

// Calendar Events API
app.get('/api/events', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/calendar.ics`);
    if (!response.ok) {
      throw new Error('Failed to fetch events');
    }
    const events = await response.text();
    res.status(200).json({ events: parseICalToEvents(events) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/:id', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/calendar/${req.params.id}.ics`);
    if (!response.ok) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = await response.text();
    res.status(200).json({ event: parseICalToEvent(event) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/events', authenticateApiKey, async (req, res) => {
  try {
    const event = EventSchema.parse(req.body);
    const eventId = generateUUID();
    
    // Create event
    const eventResponse = await fetch(`${process.env.RADICALE_URL}/calendar/${eventId}.ics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: generateICalEvent(event)
    });

    if (!eventResponse.ok) {
      throw new Error('Failed to create event');
    }

    // Create contacts for participants if requested
    if (event.createContact && event.participants) {
      for (const participant of event.participants) {
        const [firstName, ...lastNameParts] = (participant.name || participant.email.split('@')[0]).split(' ');
        const lastName = lastNameParts.join(' ') || '';
        
        const contact = {
          firstName,
          lastName,
          email: participant.email,
          nextMeeting: event.startDate,
          notes: `Created from event: ${event.summary}`
        };

        await fetch(`${process.env.RADICALE_URL}/contacts/${generateUUID()}.vcf`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
          body: generateVCard(contact)
        });
      }
    }

    res.status(201).json({ message: 'Event created successfully', event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/events/:id', authenticateApiKey, async (req, res) => {
  try {
    const event = EventSchema.parse(req.body);
    const response = await fetch(`${process.env.RADICALE_URL}/calendar/${req.params.id}.ics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: generateICalEvent(event)
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.status(200).json({ message: 'Event updated successfully', event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/events/:id', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/calendar/${req.params.id}.ics`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.status(200).json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Contacts API
app.get('/api/contacts', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/contacts.vcf`);
    if (!response.ok) {
      throw new Error('Failed to fetch contacts');
    }
    const contacts = await response.text();
    res.status(200).json({ contacts: parseVCardToContacts(contacts) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contacts/:id', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${req.params.id}.vcf`);
    if (!response.ok) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const contact = await response.text();
    res.status(200).json({ contact: parseVCardToContact(contact) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/contacts', authenticateApiKey, async (req, res) => {
  try {
    const contact = ContactSchema.parse(req.body);
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${generateUUID()}.vcf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
      body: generateVCard(contact)
    });

    if (!response.ok) {
      throw new Error('Failed to create contact');
    }

    res.status(201).json({ message: 'Contact created successfully', contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/contacts/:id', authenticateApiKey, async (req, res) => {
  try {
    const contact = ContactSchema.parse(req.body);
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${req.params.id}.vcf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
      body: generateVCard(contact)
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.status(200).json({ message: 'Contact updated successfully', contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/contacts/:id', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${req.params.id}.vcf`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.status(200).json({ message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateICalEvent(event) {
  let icalEvent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:${generateUUID()}
SUMMARY:${event.summary}
DTSTART:${new Date(event.startDate).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
DTEND:${new Date(event.endDate).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;

  if (event.description) icalEvent += `\nDESCRIPTION:${event.description}`;
  if (event.location) icalEvent += `\nLOCATION:${event.location}`;
  if (event.notes) icalEvent += `\nX-ALT-DESC;FMTTYPE=text/plain:${event.notes}`;
  
  if (event.participants) {
    event.participants.forEach(participant => {
      icalEvent += `\nATTENDEE;CN=${participant.name || ''}:mailto:${participant.email}`;
    });
  }

  icalEvent += '\nEND:VEVENT\nEND:VCALENDAR';
  return icalEvent;
}

function generateVCard(contact) {
  let vcard = `BEGIN:VCARD
VERSION:4.0
UID:${generateUUID()}
FN:${contact.firstName} ${contact.lastName}
N:${contact.lastName};${contact.firstName};;;
EMAIL:${contact.email}`;

  if (contact.phone) vcard += `\nTEL;TYPE=work:${contact.phone}`;
  if (contact.mobilePhone) vcard += `\nTEL;TYPE=cell:${contact.mobilePhone}`;
  if (contact.organization) vcard += `\nORG:${contact.organization}`;
  if (contact.nextMeeting) vcard += `\nX-NEXT-MEETING:${contact.nextMeeting}`;
  if (contact.notes) vcard += `\nNOTE:${contact.notes}`;

  vcard += '\nEND:VCARD';
  return vcard;
}

function parseICalToEvents(icalData) {
  // Implement parsing logic for iCal data
  // This is a placeholder - you should use a proper iCal parser
  return [];
}

function parseICalToEvent(icalData) {
  // Implement parsing logic for single iCal event
  // This is a placeholder - you should use a proper iCal parser
  return {};
}

function parseVCardToContacts(vcardData) {
  // Implement parsing logic for vCard data
  // This is a placeholder - you should use a proper vCard parser
  return [];
}

function parseVCardToContact(vcardData) {
  // Implement parsing logic for single vCard
  // This is a placeholder - you should use a proper vCard parser
  return {};
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
