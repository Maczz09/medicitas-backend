const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { swaggerUi, specs } = require('./config/swagger');
const { correlationMiddleware } = require('./shared/infrastructure/correlation.middleware');
const { errorHandler } = require('./shared/infrastructure/error.middleware');
const { checkIdempotency } = require('./shared/infrastructure/api_idempotency.middleware');

const authRouter = require('./modules/auth/infrastructure/http/v1/auth.routes');
const pacientesRouter = require('./modules/pacientes/infrastructure/http/v1/pacientes.routes');
const medicosRouter = require('./modules/medicos/infrastructure/http/v1/medicos.routes');
const citasRoutes = require('./modules/citas/infrastructure/http/v1/citas.routes');
const segurosRoutes = require('./modules/seguros/routes/seguros.routes');
const pagosRouter = require('./modules/pagos/routes/pagos.routes');
const hclRouter = require('./modules/historiaClinica/routes/historiaClinica.routes');
const preRouter = require('./modules/prescripciones/routes/prescripciones.routes');
const facRouter = require('./modules/facturacion/routes/facturacion.routes');
const audRouter = require('./modules/auditoria/routes/auditoria.routes');
const notRouter = require('./modules/notificaciones/routes/notificaciones.routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(correlationMiddleware);
app.use(checkIdempotency);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/pacientes', pacientesRouter);
app.use('/api/v1/medicos', medicosRouter);
app.use('/api/v1/citas', citasRoutes);
app.use('/api/v1/coberturas', segurosRoutes);
app.use('/api/v1/pagos', pagosRouter);
app.use('/api/v1/historias-clinicas', hclRouter);
app.use('/api/v1/prescripciones', preRouter);
app.use('/api/v1/facturacion', facRouter);
app.use('/api/v1/auditoria', audRouter);
app.use('/api/v1/notificaciones', notRouter);

// Ruta Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(errorHandler);

module.exports = app;
