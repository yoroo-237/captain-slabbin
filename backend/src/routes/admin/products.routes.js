import { Router } from 'express';
import { adminProductsController as c } from '../../controllers/admin/products.controller.js';
import { uploadMedia } from '../../middlewares/upload.js';

const r = Router();

r.get('/',    c.list);
r.post('/',   c.create);

r.get('/:id', async (req, res) => {
  const { prisma } = await import('../../db.js');
  const { ok }     = await import('../../utils/response.js');
  const product    = await prisma.product.findUniqueOrThrow({
    where:   { id: parseInt(req.params.id, 10) },
    include: { images: { orderBy: { position: 'asc' } }, category: true, brand: true },
  });
  res.json(ok(product));
});

r.put('/:id',    c.update);
r.delete('/:id', c.remove);

// Media by URL
r.post('/:id/images',            c.addImage);
// Media by file upload
r.post('/:id/images/upload',     uploadMedia.array('files', 20), c.uploadImage);
// Remove media
r.delete('/:id/images/:imgId',   c.removeImage);

export default r;
