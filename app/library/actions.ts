'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

function back(path: string, error?: string | null) {
  revalidatePath('/library');
  if (error) redirect(`${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}`);
}
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const here = (f: FormData) => str(f, 'return_to') || '/library';

export async function createFolder(formData: FormData) {
  const name = str(formData, 'name');
  if (!name) return back(here(formData), 'Name the folder');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('library_folders')
    .insert({ name, parent_id: str(formData, 'parent_id') || null });
  back(here(formData), error ? (error.code === '23505' ? 'A folder with this name is already here' : error.message) : null);
}

export async function renameFolder(formData: FormData) {
  const name = str(formData, 'name');
  if (!name) return back(here(formData), 'Name the folder');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('library_folders').update({ name }).eq('id', str(formData, 'id'));
  back(here(formData), error ? (error.code === '23505' ? 'A folder with this name is already here' : error.message) : null);
}

// Only an empty folder goes, so nothing is lost by a slip.
export async function deleteFolder(formData: FormData) {
  const id = str(formData, 'id');
  const supabase = await supabaseServer();
  const [{ count: sub }, { count: files }, { count: links }] = await Promise.all([
    supabase.from('library_folders').select('id', { count: 'exact', head: true }).eq('parent_id', id),
    supabase.from('files').select('id', { count: 'exact', head: true }).eq('folder_id', id),
    supabase.from('library_links').select('id', { count: 'exact', head: true }).eq('folder_id', id),
  ]);
  if ((sub ?? 0) + (files ?? 0) + (links ?? 0) > 0) return back(here(formData), 'The folder is not empty');
  const { data: folder } = await supabase.from('library_folders').select('parent_id').eq('id', id).maybeSingle();
  const { error } = await supabase.from('library_folders').delete().eq('id', id);
  if (error) return back(here(formData), error.message);
  revalidatePath('/library');
  redirect(folder?.parent_id ? `/library?f=${folder.parent_id}` : '/library');
}

export async function updateFile(formData: FormData) {
  const title = str(formData, 'title');
  if (!title) return back(here(formData), 'Give the file a title');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('files').update({
    title,
    folder_id: str(formData, 'folder_id') || null,
    level: str(formData, 'level') || null,
    staff_only: formData.get('staff_only') === 'on',
  }).eq('id', str(formData, 'id'));
  back(here(formData), error?.message);
}

export async function deleteFile(formData: FormData) {
  const id = str(formData, 'id');
  const supabase = await supabaseServer();
  const { data: file } = await supabase.from('files').select('storage_path').eq('id', id).maybeSingle();
  if (!file) return back(here(formData), 'File not found');
  const { error } = await supabase.from('files').delete().eq('id', id);
  if (error) return back(here(formData), error.message);
  await supabase.storage.from('files').remove([file.storage_path]);
  back(here(formData));
}

// Audio by page: which track plays on which page of a textbook.
export async function addAudio(formData: FormData) {
  const fileId = str(formData, 'file_id');
  const page = Number(str(formData, 'page'));
  const audioId = str(formData, 'audio_id');
  const at = `/library/${fileId}`;
  if (!audioId || !Number.isInteger(page) || page < 1) redirect(`${at}?e=${encodeURIComponent('Choose a track and a page')}`);
  const supabase = await supabaseServer();
  const { count } = await supabase.from('file_audio').select('id', { count: 'exact', head: true }).eq('file_id', fileId).eq('page', page);
  const { error } = await supabase.from('file_audio').insert({
    file_id: fileId, audio_id: audioId, page, label: str(formData, 'label') || null, position: count ?? 0,
  });
  revalidatePath(at);
  if (error) redirect(`${at}?e=${encodeURIComponent(error.message)}`);
}

export async function removeAudio(formData: FormData) {
  const fileId = str(formData, 'file_id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('file_audio').delete().eq('id', str(formData, 'id'));
  revalidatePath(`/library/${fileId}`);
  if (error) redirect(`/library/${fileId}?e=${encodeURIComponent(error.message)}`);
}

// Links (Quizlet sets, Canva, Miro …) next to the files.
function cleanUrl(raw: string) {
  const u = raw.trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

export async function addLink(formData: FormData) {
  const title = str(formData, 'title');
  const url = cleanUrl(str(formData, 'url'));
  if (!title || !url) return back(here(formData), 'Give the link a title and an address starting with https://');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('library_links').insert({
    title, url, folder_id: str(formData, 'folder_id') || null, level: str(formData, 'level') || null,
  });
  back(here(formData), error ? (error.code === '23505' ? 'This link is already in this folder' : error.message) : null);
}

export async function updateLink(formData: FormData) {
  const title = str(formData, 'title');
  const url = cleanUrl(str(formData, 'url'));
  if (!title || !url) return back(here(formData), 'Give the link a title and an address starting with https://');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('library_links').update({
    title, url, folder_id: str(formData, 'folder_id') || null, level: str(formData, 'level') || null,
    staff_only: formData.get('staff_only') === 'on',
  }).eq('id', str(formData, 'id'));
  back(here(formData), error?.message);
}

export async function deleteLink(formData: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('library_links').delete().eq('id', str(formData, 'id'));
  back(here(formData), error?.message);
}
