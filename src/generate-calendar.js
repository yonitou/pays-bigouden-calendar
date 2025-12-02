import fetch from "node-fetch";
import ical from "ical-generator";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Configuration
const CONFIG = {
  sitemapUrls: [
    "https://www.destination-paysbigouden.com/sitemap-1.xml",
    "https://www.destination-paysbigouden.com/sitemap-2.xml",
  ],
  baseUrl: "https://www.destination-paysbigouden.com",
  calendar: {
    name: "Agenda Pays Bigouden",
    description: "Événements du Pays Bigouden - Bretagne",
    timezone: "Europe/Paris",
  },
  scraping: {
    concurrency: 10,
    delayMs: 100,
  },
  defaultEventDurationHours: 2,
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractHwSheetFromHtml(html) {
  const startIndex = html.indexOf("HwSheet = {");
  if (startIndex === -1) {
    return null;
  }

  let braceCount = 0;
  let endIndex = startIndex + 10;
  let started = false;

  for (let i = startIndex; i < html.length; i++) {
    if (html[i] === "{") {
      braceCount++;
      started = true;
    } else if (html[i] === "}") {
      braceCount--;
      if (started && braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  try {
    const jsonStr = html.substring(startIndex + 10, endIndex);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function transformHwSheetToEvent(hwSheet, url) {
  const periods = hwSheet.openingPeriods?.periods || [];
  const dates = periods.map((period) => {
    const startDate = period.startDate || period._startDate;
    const endDate = period.endDate || period._endDate;
    const startTime =
      period._formated_days?.[0]?.schedules?.[0]?.startTime ||
      period.days?.[0]?.days?.[0]?.schedules?.[0]?.startTime;

    return {
      oneday: period._isOneDay || false,
      start: {
        startDate,
        startTime: startTime
          ? `à ${startTime.substring(0, 5).replace(":", "h")}`
          : null,
      },
      end: {
        endDate,
      },
    };
  });

  return {
    sheetId: hwSheet.sheetId,
    bordereau: hwSheet.bordereau,
    title: hwSheet.businessName,
    type: hwSheet.type,
    description: hwSheet.description,
    town: hwSheet.locality,
    address: hwSheet.contacts?.establishment?.address1 ||
      hwSheet.contacts?.establishment?.address2 ||
      (hwSheet.contacts?.establishment?.zipCode
        ? `${hwSheet.contacts.establishment.zipCode} ${hwSheet.contacts.establishment.commune || ''}`
        : null),
    gps: hwSheet.geolocations
      ? {
          latitude: hwSheet.geolocations.latitude,
          longitude: hwSheet.geolocations.longitude,
        }
      : null,
    phone: hwSheet.contacts?.establishment?.phones?.[0]
      ? {
          number: hwSheet.contacts.establishment.phones[0],
        }
      : null,
    dates,
    url,
  };
}

async function fetchUrlsFromSitemap(sitemapUrl) {
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  const urls = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
  return urls.map((u) => u.replace(/<\/?loc>/g, ""));
}

function isEventTooLong(event) {
  if (!event.dates?.length) return false;

  for (const d of event.dates) {
    const start = d.start?.startDate;
    const end = d.end?.endDate;
    if (start && end) {
      const durationDays = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
      if (durationDays > 31) return true; // Une période de plus d'un mois
    }
  }

  // Aussi vérifier l'écart entre première et dernière date
  const dates = event.dates.map(d => d.start?.startDate).filter(Boolean).sort();
  if (dates.length >= 2) {
    const spanDays = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (1000 * 60 * 60 * 24);
    if (spanDays > 31) return true;
  }

  return false;
}

function isExposition(event) {
  const title = event.title?.toLowerCase() || "";
  return title.includes("expo") || title.includes("exhibition");
}

async function fetchEventFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const hwSheet = extractHwSheetFromHtml(html);

    if (!hwSheet || hwSheet.bordereau !== "FMA") {
      return null;
    }

    const event = transformHwSheetToEvent(hwSheet, url);

    if (isEventTooLong(event) || isExposition(event)) {
      return null;
    }

    return event;
  } catch {
    return null;
  }
}

async function fetchAllEvents() {
  console.log("📡 Récupération des URLs depuis les sitemaps...");

  const allUrls = [];
  for (const sitemapUrl of CONFIG.sitemapUrls) {
    const urls = await fetchUrlsFromSitemap(sitemapUrl);
    const offreUrls = urls.filter((u) => u.includes("/offres/"));
    allUrls.push(...offreUrls);
    console.log(`  ${sitemapUrl}: ${offreUrls.length} URLs d'offres`);
  }

  console.log(
    `\n📡 Récupération des événements (${allUrls.length} pages à analyser)...`
  );

  const allEvents = new Map();
  let processed = 0;
  let eventCount = 0;

  for (let i = 0; i < allUrls.length; i += CONFIG.scraping.concurrency) {
    const batch = allUrls.slice(i, i + CONFIG.scraping.concurrency);
    const results = await Promise.all(batch.map(fetchEventFromUrl));

    for (const event of results) {
      if (event && !allEvents.has(event.sheetId)) {
        allEvents.set(event.sheetId, event);
        eventCount++;
      }
    }

    processed += batch.length;
    if (processed % 50 === 0 || processed === allUrls.length) {
      console.log(
        `  Progression: ${processed}/${allUrls.length} pages (${eventCount} événements)`
      );
    }

    if (i + CONFIG.scraping.concurrency < allUrls.length) {
      await new Promise((r) => setTimeout(r, CONFIG.scraping.delayMs));
    }
  }

  const result = Array.from(allEvents.values());
  console.log(`✅ ${result.length} événements trouvés`);
  return result;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildEventUrl(event) {
  return (
    event.url ||
    `${CONFIG.baseUrl}/offres/${slugify(event.title)}-${
      event.town?.toLowerCase() || "bigouden"
    }-fr-${event.sheetId}/`
  );
}

function parseTime(timeString) {
  const match = timeString?.match(/(\d{1,2})[h:](\d{2})?/);
  if (!match) return null;
  return {
    hours: parseInt(match[1], 10),
    minutes: parseInt(match[2] || "0", 10),
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
      endDate.setHours(
        time.hours + CONFIG.defaultEventDurationHours,
        time.minutes,
        0,
        0
      );
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

  return event.dates.map(parseDateOccurrence).filter(Boolean);
}

function buildEventDescription(event) {
  return event.description || "";
}

function buildEventLocation(event) {
  const parts = [];
  if (event.address) {
    parts.push(event.address.replace(/\n/g, ", "));
  }
  if (event.town && !event.address?.includes(event.town)) {
    parts.push(event.town);
  }
  return parts.join(" - ");
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
  console.log("📅 Génération du calendrier iCal...");

  const calendar = ical({
    name: CONFIG.calendar.name,
    description: CONFIG.calendar.description,
    timezone: CONFIG.calendar.timezone,
    prodId: { company: "Pays Bigouden Calendar", product: "Events" },
  });

  let addedCount = 0;

  for (const event of events) {
    const dates = parseEventDates(event);
    if (dates.length === 0) continue;

    const eventUrl = buildEventUrl(event);
    const description = buildEventDescription(event);
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

  const calendar = generateCalendar(events);

  const icsPath = join(__dirname, "..", "pays-bigouden.ics");
  const jsonPath = join(__dirname, "..", "events.json");

  writeFileSync(icsPath, calendar.toString());
  writeFileSync(jsonPath, JSON.stringify(events, null, 2));

  console.log(`\n🎉 Calendrier généré !`);
  console.log(`📁 ICS: ${icsPath}`);
  console.log(`📁 JSON: ${jsonPath}`);
}

main().catch((error) => {
  console.error("❌ Erreur:", error.message);
  process.exit(1);
});
