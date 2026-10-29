-- The example username of the QT custom order becomes the style's own handle
UPDATE "Product" SET "description" = replace("description", '@QUEENTETRA', '{handle}')
WHERE "source" = 'qt' AND "description" LIKE '%@QUEENTETRA%';
