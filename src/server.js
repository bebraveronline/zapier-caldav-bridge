import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { z } from 'zod';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

config();

const app = express();
const port = process.env.PORT || 3000;

// In-memory cache for webhooks with 1-hour TTL
const webhookCache = new NodeCache({ stdTTL: 3600 });

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
  createContact: z.boolean().optional()
});

const ContactSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
  organization: z.string().optional(),
  nextMeeting: z.string().optional(),
  notes: z.string().optional()
});

const WebhookSchema = z.object({
  url: z.string().url(),
  event: z.enum(['created', 'updated', 'cancelled', 'rescheduled']),
  type: z.enum(['calendar', 'contact']),
  targetUrl: z.string().url()
});

// API key middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  next();
};

// Webhook registration endpoints
app.post('/api/webhooks', authenticateApiKey, async (req, res) => {
  try {
    const webhook = WebhookSchema.parse(req.body);
    const webhookId = generateUUID();
    webhookCache.set(webhookId, webhook);
    
    res.status(201).json({
      id: webhookId,
      message: 'Webhook registered successfully',
      webhook
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/webhooks/:id', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  if (webhookCache.del(id)) {
    res.status(200).json({ message: 'Webhook deleted successfully' });
  } else {
    res.status(404).json({ error: 'Webhook not found' });
  }
});

// Helper function to notify webhooks
async function notifyWebhooks(type, event, data) {
  const webhooks = webhookCache.keys()
    .map(key => ({ id: key, ...webhookCache.get(key) }))
    .filter(webhook => webhook.type === type && webhook.event === event);

  for (const webhook of webhooks) {
    try {
      await fetch(webhook.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': webhook.id
        },
        body: JSON.stringify(data)
      });
    } catch (error) {
      console.error(`Failed to notify webhook ${webhook.id}:`, error);
    }
  }
}

// Calendar subscription endpoints
app.get('/calendar/:calendarId/full.ics', authenticateApiKey, async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/${req.params.calendarId}/calendar.ics`);
    if (!response.ok) {
      throw new Error('Failed to fetch calendar');
    }
    const calendar = await response.text();
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(calendar);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/calendar/:calendarId/freebusy.ics', async (req, res) => {
  try {
    const response = await fetch(`${process.env.RADICALE_URL}/${req.params.calendarId}/freebusy.ics`);
    if (!response.ok) {
      throw new Error('Failed to fetch free/busy information');
    }
    const freebusy = await response.text();
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(freebusy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

    // Notify webhooks
    await notifyWebhooks('calendar', 'created', { event, id: eventId });

    res.status(201).json({ 
      message: 'Event created successfully', 
      event,
      subscriptionUrls: {
        full: `/calendar/${eventId}/full.ics`,
        freebusy: `/calendar/${eventId}/freebusy.ics`
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/events/:id', authenticateApiKey, async (req, res) => {
  try {
    const event = EventSchema.parse(req.body);
    const eventId = req.params.id;
    
    // Check if this is a reschedule
    const oldEventResponse = await fetch(`${process.env.RADICALE_URL}/calendar/${eventId}.ics`);
    const oldEvent = oldEventResponse.ok ? await oldEventResponse.text() : null;
    const isReschedule = oldEvent && hasDateChanged(oldEvent, event);

    const response = await fetch(`${process.env.RADICALE_URL}/calendar/${eventId}.ics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: generateICalEvent(event)
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Notify webhooks
    const eventType = isReschedule ? 'rescheduled' : 'updated';
    await notifyWebhooks('calendar', eventType, { event, id: eventId });

    res.status(200).json({ message: 'Event updated successfully', event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/events/:id', authenticateApiKey, async (req, res) => {
  try {
    const eventId = req.params.id;
    
    // Get event details before deletion for webhook
    const eventResponse = await fetch(`${process.env.RADICALE_URL}/calendar/${eventId}.ics`);
    const eventDetails = eventResponse.ok ? await eventResponse.text() : null;

    const response = await fetch(`${process.env.RADICALE_URL}/calendar/${eventId}.ics`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Notify webhooks
    if (eventDetails) {
      await notifyWebhooks('calendar', 'cancelled', { 
        id: eventId,
        event: parseICalToEvent(eventDetails)
      });
    }

    res.status(200).json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Contacts API with webhook support
app.post('/api/contacts', authenticateApiKey, async (req, res) => {
  try {
    const contact = ContactSchema.parse(req.body);
    const contactId = generateUUID();
    
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${contactId}.vcf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
      body: generateVCard(contact)
    });

    if (!response.ok) {
      throw new Error('Failed to create contact');
    }

    // Notify webhooks
    await notifyWebhooks('contact', 'created', { contact, id: contactId });

    res.status(201).json({ message: 'Contact created successfully', contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/contacts/:id', authenticateApiKey, async (req, res) => {
  try {
    const contact = ContactSchema.parse(req.body);
    const contactId = req.params.id;
    
    const response = await fetch(`${process.env.RADICALE_URL}/contacts/${contactId}.vcf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
      body: generateVCard(contact)
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Notify webhooks
    await notifyWebhooks('contact', 'updated', { contact, id: contactId });

    res.status(200).json({ message: 'Contact updated successfully', contact });
  } catch (error) {
    res.status(400).json({ error: error.message });
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

function hasDateChanged(oldEventData, newEvent) {
  const oldEvent = parseICalToEvent(oldEventData);
  return oldEvent.startDate !== newEvent.startDate || oldEvent.endDate !== newEvent.endDate;
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