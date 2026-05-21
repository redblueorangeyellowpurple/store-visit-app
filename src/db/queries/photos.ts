import { supabase } from '../client.js';

export type SectionKey =
  | 'good_news'
  | 'people_training'
  | 'competitor'
  | 'display_stock'
  | 'follow_up';

export interface VisitPhoto {
  id: string;
  visit_id: string;
  storage_path: string;
  caption: string | null;
  photo_tag: 'display' | 'competitor' | 'stock' | 'staff' | 'other' | null;
  section_key: SectionKey | null;
  file_size: number | null;
  analyzed_at: string | null;
  created_at: string;
}

export async function uploadVisitPhoto(
  visitId: string,
  fileBuffer: Buffer,
  storeId: string,
  sectionKey: SectionKey | null = null,
): Promise<VisitPhoto | null> {
  const photoId = crypto.randomUUID();
  const storagePath = `${storeId}/${visitId}/${photoId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('sva-photos')
    .upload(storagePath, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError) {
    console.error('Photo upload error:', uploadError);
    return null;
  }

  const { data, error } = await supabase
    .from('visit_photos')
    .insert({
      visit_id: visitId,
      storage_path: storagePath,
      file_size: fileBuffer.length,
      section_key: sectionKey,
    })
    .select()
    .single();

  if (error) {
    console.error('Photo record error:', error);
    return null;
  }
  return data as VisitPhoto;
}

export async function getPhotosForVisit(visitId: string): Promise<VisitPhoto[]> {
  const { data, error } = await supabase
    .from('visit_photos')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at');

  if (error || !data) return [];
  return data as VisitPhoto[];
}

// Wipes all photos for one section of a visit (rows + storage objects).
// Used by the visit flow's ← Back button: when the CM jumps back to redo a
// question, anything they uploaded for that section should disappear.
// Returns the count of photos removed so the caller can adjust running totals.
export async function deletePhotosBySection(
  visitId: string,
  sectionKey: SectionKey,
): Promise<number> {
  const { data: rows, error: selErr } = await supabase
    .from('visit_photos')
    .select('storage_path')
    .eq('visit_id', visitId)
    .eq('section_key', sectionKey);

  if (selErr) {
    console.error('deletePhotosBySection select error:', selErr);
    return 0;
  }
  const paths = (rows ?? [])
    .map((r: { storage_path: string | null }) => r.storage_path)
    .filter((p): p is string => Boolean(p));

  const { error: delErr } = await supabase
    .from('visit_photos')
    .delete()
    .eq('visit_id', visitId)
    .eq('section_key', sectionKey);
  if (delErr) {
    console.error('deletePhotosBySection delete error:', delErr);
    return 0;
  }

  if (paths.length > 0) {
    const { error: storErr } = await supabase.storage.from('sva-photos').remove(paths);
    if (storErr) console.error('deletePhotosBySection storage error:', storErr);
  }
  return paths.length;
}

export async function signPhotoUrls(
  paths: string[],
  ttlSec = 300,
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage
    .from('sva-photos')
    .createSignedUrls(paths, ttlSec);
  if (error || !data) {
    console.error('signPhotoUrls error:', error);
    return [];
  }
  return data
    .map((d: any) => d.signedUrl as string)
    .filter((u: string) => Boolean(u));
}
