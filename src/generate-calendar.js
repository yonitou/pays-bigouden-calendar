import fetch from 'node-fetch';
import ical from 'ical-generator';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENDA_URL = 'https://www.destination-paysbigouden.com/a-voir-a-faire/agenda';
const BASE_URL = 'https://www.destination-paysbigouden.com';

async function fetchEventsFromPage(page) {
  const url = page === 1 ? AGENDA_URL : `${AGENDA_URL}?listpage=${page}`;
  const response = await fetch(url);
  const html = await response.text();

  const match = html.match(/var\s+itemsData\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return [];
  }

  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.warn(`⚠️ Erreur parsing page ${page}: ${e.message}`);
    return [];
  }
}

async function fetchEvents() {
  console.log('📡 Récupération des événements (pagination)...');

  const allEvents = new Map();
  let page = 1;
  let consecutiveEmpty = 0;

  while (consecutiveEmpty < 2) {
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

    // Limite de sécurité
    if (page > 50) break;
  }

  const result = Array.from(allEvents.values());
  console.log(`✅ ${result.length} événements uniques trouvés`);
  return result;
}

function buildEventUrl(event) {
  // Construire l'URL de la fiche événement
  // Format typique : /fiche/[bordereau]/[sheetId]/[slug]
  const slug = event.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return `${BASE_URL}/fiche/${event.bordereau}/${event.sheetId}/${slug}`;
}

function parseEventDates(event) {
  const parsedDates = [];

  if (!event.dates || event.dates.length === 0) {
    return parsedDates;
  }

  for (const dateInfo of event.dates) {
    try {
      const startDateStr = dateInfo.start?.startDate;
      const endDateStr = dateInfo.end?.endDate;

      if (!startDateStr) continue;

      let startDate = new Date(startDateStr);
      let endDate = endDateStr ? new Date(endDateStr) : new Date(startDate);

      // Extraire l'heure si disponible
      const startTime = dateInfo.start?.startTime;
      if (startTime) {
        const timeMatch = startTime.match(/(\d{1,2})[h:](\d{2})?/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2] || '0', 10);
          startDate.setHours(hours, minutes, 0, 0);

          // Par défaut, événement de 2h si pas d'heure de fin
          if (!endDateStr || dateInfo.oneday) {
            endDate = new Date(startDate);
            endDate.setHours(hours + 2, minutes, 0, 0);
          }
        }
      }

      // Vérifier que l'événement n'est pas déjà passé
      if (endDate >= new Date()) {
        parsedDates.push({ start: startDate, end: endDate });
      }
    } catch (e) {
      console.warn(`⚠️ Erreur parsing date pour "${event.title}":`, e.message);
    }
  }

  return parsedDates;
}

function generateCalendar(events) {
  console.log('📅 Génération du calendrier iCal...');

  const calendar = ical({
    name: 'Agenda Pays Bigouden',
    description: 'Événements du Pays Bigouden - Bretagne',
    timezone: 'Europe/Paris',
    prodId: { company: 'Pays Bigouden Calendar', product: 'Events' },
    url: AGENDA_URL
  });

  let addedCount = 0;

  for (const event of events) {
    const dates = parseEventDates(event);

    if (dates.length === 0) continue;

    const eventUrl = buildEventUrl(event);

    // Construire la description
    const descriptionParts = [];
    if (event.description) {
      descriptionParts.push(event.description);
    }
    if (event.phone?.number) {
      descriptionParts.push(`📞 ${event.phone.number}`);
    }
    descriptionParts.push(`🔗 ${eventUrl}`);

    const description = descriptionParts.join('\n\n');

    // Construire le lieu
    const locationParts = [];
    if (event.address) {
      locationParts.push(event.address.replace(/\n/g, ', '));
    }
    if (event.town && !event.address?.includes(event.town)) {
      locationParts.push(event.town);
    }
    const location = locationParts.join(' - ');

    // Créer un événement pour chaque date
    for (let i = 0; i < dates.length; i++) {
      const { start, end } = dates[i];
      const uid = `${event.sheetId}-${i}@pays-bigouden-calendar`;

      calendar.createEvent({
        id: uid,
        start,
        end,
        summary: event.title,
        description,
        location,
        url: eventUrl,
        categories: event.type ? [{ name: event.type }] : undefined,
        geo: event.gps?.latitude && event.gps?.longitude ? {
          lat: parseFloat(event.gps.latitude),
          lon: parseFloat(event.gps.longitude)
        } : undefined
      });

      addedCount++;
    }
  }

  console.log(`✅ ${addedCount} occurrences d'événements ajoutées au calendrier`);
  return calendar;
}

async function main() {
  try {
    const events = await fetchEvents();
    const calendar = generateCalendar(events);

    const outputPath = join(__dirname, '..', 'pays-bigouden.ics');
    writeFileSync(outputPath, calendar.toString());

    console.log(`\n🎉 Calendrier généré avec succès !`);
    console.log(`📁 Fichier : ${outputPath}`);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

main();