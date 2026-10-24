import { productService } from '../services/product.service.js';
import { ok } from '../utils/response.js';

export const productController = {
  async list(req, res) {
    const result = await productService.list(req.query);
    res.json(ok(result));
  },

  async getOne(req, res) {
    const product = await productService.getBySlug(req.params.slug);
    res.json(ok(product));
  },

  async getRelated(req, res) {
    const related = await productService.getRelated(req.params.slug);
    res.json(ok(related));
  },
};
