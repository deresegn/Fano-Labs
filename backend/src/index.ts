import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { router as api } from './routes/api';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.get('/health', (_req, res) => res.json({ ok: true, status: 'healthy' }));
app.use('/', api);

app.listen(PORT, () => console.log(`[backend] listening on http://127.0.0.1:${PORT}`));
