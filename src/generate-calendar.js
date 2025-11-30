import fetch from 'node-fetch';
import ical from 'ical-generator';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Configuration
const CONFIG = {
  agendaUrl: 'https://www.destination-paysbigouden.com/a-voir-a-faire/agenda',
  baseUrl: 'https://www.destination-paysbigouden.com',
  calendar: {
    name: 'Agenda Pays Bigouden',
    description: 'Événements du Pays Bigouden - Bretagne',
    timezone: 'Europe/Paris',
  },
  filters: {
    excludedTypes: ['EXPOSITION'],
    maxOccurrences: 20,
    maxDurationDays: 60,
  },
  scraping: {
    maxPages: 50,
    maxConsecutiveEmpty: 2,
  },
  defaultEventDurationHours: 2,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function getEventDurationDays(event) {
  if (!event.dates?.[0]?.start?.startDate || !event.dates?.[0]?.end?.endDate) {
    return 0;
  }
  const start = new Date(event.dates[0].start.startDate);
  const end = new Date(event.dates[0].end.endDate);
  return (end - start) / MS_PER_DAY;
}

function shouldExcludeEvent(event) {
  const type = event.type?.toUpperCase();
  if (CONFIG.filters.excludedTypes.includes(type)) {
    return true;
  }

  const occurrences = event.dates?.length || 0;
  if (occurrences > CONFIG.filters.maxOccurrences) {
    return true;
  }

  const durationDays = getEventDurationDays(event);
  if (durationDays > CONFIG.filters.maxDurationDays) {
    return true;
  }

  return false;
}

function extractItemsDataFromHtml(html) {
  const match = html.match(/var\s+itemsData\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

async function fetchEventsFromPage(page) {
  const url = page === 1
    ? CONFIG.agendaUrl
    : `${CONFIG.agendaUrl}?listpage=${page}`;

  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const events = extractItemsDataFromHtml(html);

  return events || [];
}

async function fetchAllEvents() {
  console.log('📡 Récupération des événements...');

  const allEvents = new Map();
  let page = 1;
  let consecutiveEmpty = 0;

  while (consecutiveEmpty < CONFIG.scraping.maxConsecutiveEmpty && page <= CONFIG.scraping.maxPages) {
    const events = await fetchEventsFromPage(page);

    if (events.length === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
      let newCount = 0;
      for (const event of events) {
        if (!allEvents.has(event.sheetId)) {
          allEvents.set(event.sheetId, event);
          newCount++;
        }
      }
      console.log(`  Page ${page}: ${events.length} événements (${newCount} nouveaux)`);
    }

    page++;
  }

  const result = Array.from(allEvents.values());
  console.log(`✅ ${result.length} événements uniques trouvés`);
  return result;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildEventUrl(event) {
  const slug = slugify(event.title);
  return `${CONFIG.baseUrl}/fiche/${event.bordereau}/${event.sheetId}/${slug}`;
}

function parseTime(timeString) {
  const match = timeString?.match(/(\d{1,2})[h:](\d{2})?/);
  if (!match) return null;
  return {
    hours: parseInt(match[1], 10),
    minutes: parseInt(match[2] || '0', 10),
  };
}

function parseDateOccurrence(dateInfo) {
  const startDateStr = dateInfo.start?.startDate;
  if (!startDateStr) return null;

  const endDateStr = dateInfo.end?.endDate;
  let startDate = new Date(startDateStr);
  let endDate = endDateStr ? new Date(endDateStr) : new Date(startDate);

  const time = parseTime(dateInfo.start?.startTime);
  if (time) {
    startDate.setHours(time.hours, time.minutes, 0, 0);
    if (!endDateStr || dateInfo.oneday) {
      endDate = new Date(startDate);
      endDate.setHours(time.hours + CONFIG.defaultEventDurationHours, time.minutes, 0, 0);
    }
  }

  if (endDate < new Date()) {
    return null;
  }

  return { start: startDate, end: endDate };
}

function parseEventDates(event) {
  if (!event.dates?.length) {
    return [];
  }

  return event.dates
    .map(parseDateOccurrence)
    .filter(Boolean);
}

function buildEventDescription(event, eventUrl) {
  const parts = [];
  if (event.description) {
    parts.push(event.description);
  }
  if (event.phone?.number) {
    parts.push(`📞 ${event.phone.number}`);
  }
  parts.push(`🔗 ${eventUrl}`);
  return parts.join('\n\n');
}

function buildEventLocation(event) {
  const parts = [];
  if (event.address) {
    parts.push(event.address.replace(/\n/g, ', '));
  }
  if (event.town && !event.address?.includes(event.town)) {
    parts.push(event.town);
  }
  return parts.join(' - ');
}

function buildEventGeo(event) {
  if (!event.gps?.latitude || !event.gps?.longitude) {
    return undefined;
  }
  return {
    lat: parseFloat(event.gps.latitude),
    lon: parseFloat(event.gps.longitude),
  };
}

function generateCalendar(events) {
  console.log('📅 Génération du calendrier iCal...');

  const calendar = ical({
    name: CONFIG.calendar.name,
    description: CONFIG.calendar.description,
    timezone: CONFIG.calendar.timezone,
    prodId: { company: 'Pays Bigouden Calendar', product: 'Events' },
    url: CONFIG.agendaUrl,
  });

  let addedCount = 0;

  for (const event of events) {
    const dates = parseEventDates(event);
    if (dates.length === 0) continue;

    const eventUrl = buildEventUrl(event);
    const description = buildEventDescription(event, eventUrl);
    const location = buildEventLocation(event);
    const geo = buildEventGeo(event);

    for (let i = 0; i < dates.length; i++) {
      const { start, end } = dates[i];

      calendar.createEvent({
        id: `${event.sheetId}-${i}@pays-bigouden-calendar`,
        start,
        end,
        summary: event.title,
        description,
        location,
        url: eventUrl,
        categories: event.type ? [{ name: event.type }] : undefined,
        geo,
      });

      addedCount++;
    }
  }

  console.log(`✅ ${addedCount} occurrences ajoutées au calendrier`);
  return calendar;
}

async function main() {
  const events = await fetchAllEvents();

  const filteredEvents = events.filter(e => !shouldExcludeEvent(e));
  const excludedCount = events.length - filteredEvents.length;
  console.log(`⏭️  ${excludedCount} événements exclus`);

  const calendar = generateCalendar(filteredEvents);

  const icsPath = join(__dirname, '..', 'pays-bigouden.ics');
  const jsonPath = join(__dirname, '..', 'events.json');

  writeFileSync(icsPath, calendar.toString());
  writeFileSync(jsonPath, JSON.stringify(filteredEvents, null, 2));

  console.log(`\n🎉 Calendrier généré !`);
  console.log(`📁 ICS: ${icsPath}`);
  console.log(`📁 JSON: ${jsonPath}`);
}

main().catch(error => {
  console.error('❌ Erreur:', error.message);
  process.exit(1);
});