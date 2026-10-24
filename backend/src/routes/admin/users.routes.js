import { Router } from 'express';
import { adminUsersController as c } from '../../controllers/admin/users.controller.js';

const r = Router();

r.get('/',                   c.list);
r.post('/',                  c.create);
r.get('/:id',                c.getOne);
r.put('/:id',                c.update);
r.patch('/:id/ban',          c.ban);
r.patch('/:id/password',     c.setPassword);
r.post('/:id/wallet/adjust', c.adjustWallet);
r.delete('/:id',             c.remove);

export default r;
