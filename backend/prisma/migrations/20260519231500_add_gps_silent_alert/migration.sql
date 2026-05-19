-- Adiciona valor GPS_SILENT ao enum AlertType.
-- Caso o rastreador mantenha heartbeat (device.lastUpdate continua atualizando)
-- mas pare de mandar nova `position` por mais de 5 min, o cron de alertas
-- gera um alerta crítico desse tipo. É a contrapartida do OFFLINE — OFFLINE
-- pega quando o device some por completo; GPS_SILENT pega o cenário pior
-- (rastreador vivo, GPS morto — sintoma típico de antena coberta/arrancada).

ALTER TYPE "AlertType" ADD VALUE 'GPS_SILENT';
