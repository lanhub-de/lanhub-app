// Library folders: paths, levels and team-only guesses shared by the pages,
// the folder upload and the "+ from the library" pickers.
export type Folder = { id: string; name: string; parent_id: string | null };
export type LibFile = {
  id: string; title: string; folder_id: string | null; level: string | null;
  staff_only: boolean; size_bytes: number | null; mime: string; visibility: string; uploaded_by: string;
};

export const MAX_BYTES = 50 * 1024 * 1024;
const LEVEL = /^(A1|A2|B1\+?|B2|C1|C2)(\.\d)?$/i;

export function folderPath(folders: Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && out.length < 20) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return out;
}

export function pathLabel(folders: Folder[], id: string | null) {
  return folderPath(folders, id).map((f) => f.name).join(' / ');
}

// The nearest folder named like a level (A1, B1+, …) gives the file its level.
export function levelOf(names: string[]): string | null {
  for (let i = names.length - 1; i >= 0; i--) {
    const m = names[i].trim().replace(/^А/, 'A').replace(/^В/, 'B').replace(/^С/, 'C').match(LEVEL);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// Teacher guides stay with the team.
export function looksTeamOnly(name: string) {
  return /методичк|методич|для виклад|lehrerhandbuch|handreichung|teacher'?s? (guide|book)|lösungen|loesungen|schlüssel/i.test(name);
}

export function tidyTitle(fileName: string) {
  return fileName.replace(/\.(pdf|mp3|m4a|wav|ogg)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isAudio(mime: string) { return mime.startsWith('audio/'); }

export function fmtSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Options for a picker: grouped by folder path, team-only files left out.
export function pickerGroups(files: LibFile[], folders: Folder[], noFolder: string) {
  const groups = new Map<string, LibFile[]>();
  for (const f of files) {
    if (f.staff_only) continue;
    const label = pathLabel(folders, f.folder_id) || noFolder;
    groups.set(label, [...(groups.get(label) ?? []), f]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'));
}
