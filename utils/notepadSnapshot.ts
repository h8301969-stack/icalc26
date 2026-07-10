import { RestockLineItem } from '../types';
import { InventoryItem } from '../hooks/usePOS';

export function parseNotepadSnapshot(
  notes: string,
  inventory: InventoryItem[]
): { lineItems: RestockLineItem[]; freeNotes: string } {
  const raw = notes.trim();
  if (!raw) return { lineItems: [], freeNotes: '' };

  const summaryIdx = raw.search(/\n= \d+\s*$/);
  const body = summaryIdx >= 0 ? raw.slice(0, summaryIdx).trim() : raw;
  const chunks = body.split(/\n\n+/);
  const itemChunk = chunks[0] ?? '';
  const freeNotes = chunks.slice(1).join('\n\n').trim();

  const lineItems: RestockLineItem[] = [];
  for (const part of itemChunk.split('\n')) {
    const line = part.trim();
    if (!line) continue;
    const match = line.match(/^(.+?)[\t ]*[×x][\t ]*(\d+(?:\.\d+)?)\s*$/i);
    if (!match) continue;
    const name = match[1].trim();
    const qty = Math.max(1, Math.round(parseFloat(match[2])));
    const inv = inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
    lineItems.push({
      itemId: inv?.id ?? `note-${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      qty,
    });
  }

  return { lineItems, freeNotes };
}

export function buildNotepadPrintBody(
  title: string,
  lineItems: RestockLineItem[],
  freeNotes = '',
  timestampLabel?: string
): string {
  const total = lineItems.reduce((sum, line) => sum + line.qty, 0);
  const parts: string[] = [title.trim()];
  if (timestampLabel?.trim()) parts.push(timestampLabel.trim());
  parts.push('');
  if (lineItems.length > 0) {
    parts.push(...lineItems.map((l) => `${l.name} × ${l.qty}`));
  }
  if (freeNotes.trim()) {
    parts.push('', freeNotes.trim());
  }
  parts.push('', `= ${total}`);
  return parts.join('\n');
}

export function buildNotepadPrintBodyFromNotes(title: string, notes: string, timestampLabel?: string): string {
  const trimmed = notes.trim();
  if (!trimmed) {
    return [title, timestampLabel, '', '= 0'].filter(Boolean).join('\n');
  }
  if (timestampLabel) {
    return `${title}\n${timestampLabel}\n\n${trimmed}`;
  }
  return `${title}\n\n${trimmed}`;
}