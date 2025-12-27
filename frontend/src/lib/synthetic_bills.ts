import { type Bill } from "./api";

// Simple CSV Parser handling quotes
function parseCSV(text: string): Bill[] {
  const lines: string[][] = [];
  let row: string[] = [];
  let current = "";
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (insideQuote && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      row.push(current);
      current = "";
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (current || row.length > 0) row.push(current);
      if (row.length > 0) lines.push(row);
      row = [];
      current = "";
      if (char === '\r' && next === '\n') i++; // skip \n
    } else {
      current += char;
    }
  }
  if (current || row.length > 0) row.push(current);
  if (row.length > 0) lines.push(row);

  // Skip header
  const data = lines.slice(1);

  return data.map(cols => {
    // "Title","Summary","Text","Economy","Climate","Healthcare","Immigration","Education"
    // Note: cols indices depend on CSV layout
    const title = cols[0];
    const summary = cols[1];
    const text_content = cols[2];

    return {
      title,
      summary,
      text_content: text_content.replace(/\\n/g, "\n"), // Handle manual escapes if any, mostly handled by parser though
      issue_vector: {
        economy: parseFloat(cols[3] || "0"),
        climate: parseFloat(cols[4] || "0"),
        healthcare: parseFloat(cols[5] || "0"),
        immigration: parseFloat(cols[6] || "0"),
        education: parseFloat(cols[7] || "0"),
      }
    };
  }).filter(b => b.title && b.summary);
}

export async function loadBills(): Promise<Bill[]> {
  try {
    const res = await fetch("/bills.csv");
    if (!res.ok) throw new Error("Status " + res.status);
    const txt = await res.text();
    return parseCSV(txt);
  } catch (e) {
    console.warn("Failed to load bills.csv.", e);
    return [];
  }
}


