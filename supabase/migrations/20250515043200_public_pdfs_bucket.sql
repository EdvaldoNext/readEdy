-- Tornar o bucket 'pdfs' público para que os arquivos possam ser baixados
-- diretamente via URL pública sem CORS preflight (compatível com TVs/WebKit antigo).
UPDATE storage.buckets SET public = true WHERE id = 'pdfs';
