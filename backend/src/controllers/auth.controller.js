import { authService } from '../services/auth.service.js';
import { ok } from '../utils/response.js';

export const authController = {
  async register(req, res) {
    const result = await authService.register(req.body);
    res.status(201).json(ok(result));
  },

  async login(req, res) {
    const result = await authService.login(req.body);
    res.json(ok(result));
  },

  async refresh(req, res) {
    const result = await authService.refresh(req.body.refreshToken);
    res.json(ok(result));
  },

  async logout(req, res) {
    res.json(ok({ message: 'Logged out successfully' }));
  },
};
