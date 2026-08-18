import express from 'express';
import cors from 'cors';
import { router } from './routes/api';

const PORT = Number(process.env.PORT) || 3001;

const app = express();

app.use(cors({
  origin: ['tauri://localhost', 'http://localhost:5173', 'http://127.0.0.1:3001', 'http://localhost:3001', '*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options(/.*/, cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

app.get(['/health', '/api/health', '/v1/health'], (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.use('/api', router);
app.use('/', router);

app.listen(PORT, () => {
  console.log(`FANO-LABS backend running on http://127.0.0.1:${PORT}`);
  console.log(`Health: http://127.0.0.1:${PORT}/health`);
});