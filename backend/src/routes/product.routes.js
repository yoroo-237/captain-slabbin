import { Router } from 'express';
import { productController } from '../controllers/product.controller.js';

const r = Router();

r.get('/',              productController.list);
r.get('/:slug/related', productController.getRelated);
r.get('/:slug',         productController.getOne);

export default r;
