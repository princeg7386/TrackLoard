import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { UserRole } from '@school-bus/shared';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'school-bus-backend',
    timestamp: new Date().toISOString(),
    rolesSupported: Object.values(UserRole),
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[TransportBackend] Server running on port ${PORT}`);
  });
}

export default app;
