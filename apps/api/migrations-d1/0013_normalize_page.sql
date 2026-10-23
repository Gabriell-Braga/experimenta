-- Página normalizada sem index.html nem .html (fase 20.3, D-098): /loja/ = /loja/index.html = /loja e
-- /loja/checkout.html = /loja/checkout. Regrava a coluna dos eventos já gravados com a regra nova de normalizePage.
UPDATE events SET page = substr(page, 1, length(page) - 11) WHERE page GLOB '*/index.html';
UPDATE events SET page = substr(page, 1, length(page) - 10) WHERE page GLOB '*/index.htm';
UPDATE events SET page = substr(page, 1, length(page) - 5) WHERE page GLOB '*.html';
UPDATE events SET page = substr(page, 1, length(page) - 4) WHERE page GLOB '*.htm';
