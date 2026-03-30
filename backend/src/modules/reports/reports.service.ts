import { Injectable, Logger } from '@nestjs/common';
import { TraccarService, type TraccarPosition } from '../traccar/traccar.service';
import * as ExcelJS from 'exceljs';

export interface Trip {
  startTime: string;
  endTime: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  startAddress: string;
  endAddress: string;
  distance: number; // km
  duration: number; // minutos
  maxSpeed: number; // km/h
  avgSpeed: number; // km/h
}

export interface Stop {
  latitude: number;
  longitude: number;
  address: string;
  startTime: string;
  endTime: string;
  duration: number; // minutos
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly STOP_THRESHOLD_MS = 5 * 60 * 1000; // 5 min para considerar parada
  private readonly SPEED_THRESHOLD_KNOTS = 2; // abaixo disso = parado

  constructor(private traccarService: TraccarService) {}

  async getPositions(deviceId: number, from: string, to: string): Promise<TraccarPosition[]> {
    return this.traccarService.getPositions(deviceId, from, to);
  }

  async getTrips(deviceId: number, from: string, to: string): Promise<Trip[]> {
    const positions = await this.getPositions(deviceId, from, to);
    if (positions.length < 2) return [];

    const trips: Trip[] = [];
    let tripStart: TraccarPosition | null = null;
    let tripPositions: TraccarPosition[] = [];
    let maxSpeed = 0;
    let totalSpeed = 0;
    let speedCount = 0;

    for (const pos of positions) {
      const isMoving = pos.speed > this.SPEED_THRESHOLD_KNOTS;

      if (isMoving) {
        if (!tripStart) tripStart = pos;
        tripPositions.push(pos);
        const kmh = pos.speed * 1.852;
        maxSpeed = Math.max(maxSpeed, kmh);
        totalSpeed += kmh;
        speedCount++;
      } else if (tripStart && tripPositions.length > 0) {
        // Verificar se parou por tempo suficiente para encerrar viagem
        const lastMoving = tripPositions[tripPositions.length - 1];
        const gap = new Date(pos.deviceTime).getTime() - new Date(lastMoving.deviceTime).getTime();

        if (gap > this.STOP_THRESHOLD_MS) {
          const endPos = lastMoving;
          const distance = this.calculateDistance(tripPositions);
          const duration = (new Date(endPos.deviceTime).getTime() - new Date(tripStart.deviceTime).getTime()) / 60000;

          trips.push({
            startTime: tripStart.deviceTime,
            endTime: endPos.deviceTime,
            startLat: tripStart.latitude,
            startLng: tripStart.longitude,
            endLat: endPos.latitude,
            endLng: endPos.longitude,
            startAddress: tripStart.address || '',
            endAddress: endPos.address || '',
            distance: Math.round(distance * 100) / 100,
            duration: Math.round(duration),
            maxSpeed: Math.round(maxSpeed),
            avgSpeed: speedCount > 0 ? Math.round(totalSpeed / speedCount) : 0,
          });

          tripStart = null;
          tripPositions = [];
          maxSpeed = 0;
          totalSpeed = 0;
          speedCount = 0;
        }
      }
    }

    // Fechar última viagem aberta
    if (tripStart && tripPositions.length > 1) {
      const endPos = tripPositions[tripPositions.length - 1];
      const distance = this.calculateDistance(tripPositions);
      const duration = (new Date(endPos.deviceTime).getTime() - new Date(tripStart.deviceTime).getTime()) / 60000;

      trips.push({
        startTime: tripStart.deviceTime,
        endTime: endPos.deviceTime,
        startLat: tripStart.latitude,
        startLng: tripStart.longitude,
        endLat: endPos.latitude,
        endLng: endPos.longitude,
        startAddress: tripStart.address || '',
        endAddress: endPos.address || '',
        distance: Math.round(distance * 100) / 100,
        duration: Math.round(duration),
        maxSpeed: Math.round(maxSpeed),
        avgSpeed: speedCount > 0 ? Math.round(totalSpeed / speedCount) : 0,
      });
    }

    return trips;
  }

  async getStops(deviceId: number, from: string, to: string): Promise<Stop[]> {
    const positions = await this.getPositions(deviceId, from, to);
    if (positions.length < 2) return [];

    const stops: Stop[] = [];
    let stopStart: TraccarPosition | null = null;

    for (const pos of positions) {
      const isStopped = pos.speed <= this.SPEED_THRESHOLD_KNOTS;

      if (isStopped) {
        if (!stopStart) stopStart = pos;
      } else if (stopStart) {
        const duration = new Date(pos.deviceTime).getTime() - new Date(stopStart.deviceTime).getTime();
        if (duration >= this.STOP_THRESHOLD_MS) {
          stops.push({
            latitude: stopStart.latitude,
            longitude: stopStart.longitude,
            address: stopStart.address || '',
            startTime: stopStart.deviceTime,
            endTime: pos.deviceTime,
            duration: Math.round(duration / 60000),
          });
        }
        stopStart = null;
      }
    }

    // Fechar última parada
    if (stopStart) {
      const lastPos = positions[positions.length - 1];
      const duration = new Date(lastPos.deviceTime).getTime() - new Date(stopStart.deviceTime).getTime();
      if (duration >= this.STOP_THRESHOLD_MS) {
        stops.push({
          latitude: stopStart.latitude,
          longitude: stopStart.longitude,
          address: stopStart.address || '',
          startTime: stopStart.deviceTime,
          endTime: lastPos.deviceTime,
          duration: Math.round(duration / 60000),
        });
      }
    }

    return stops;
  }

  async exportExcel(
    type: string,
    deviceId: number,
    from: string,
    to: string,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Relatório');

    if (type === 'positions') {
      const positions = await this.getPositions(deviceId, from, to);
      sheet.columns = [
        { header: 'Data/Hora', key: 'time', width: 22 },
        { header: 'Latitude', key: 'lat', width: 14 },
        { header: 'Longitude', key: 'lng', width: 14 },
        { header: 'Velocidade (km/h)', key: 'speed', width: 18 },
        { header: 'Direção', key: 'course', width: 10 },
        { header: 'Endereço', key: 'address', width: 40 },
      ];
      positions.forEach((p) =>
        sheet.addRow({
          time: p.deviceTime,
          lat: p.latitude,
          lng: p.longitude,
          speed: Math.round(p.speed * 1.852),
          course: Math.round(p.course),
          address: p.address || '',
        }),
      );
    } else if (type === 'trips') {
      const trips = await this.getTrips(deviceId, from, to);
      sheet.columns = [
        { header: 'Início', key: 'start', width: 22 },
        { header: 'Fim', key: 'end', width: 22 },
        { header: 'Duração (min)', key: 'duration', width: 14 },
        { header: 'Distância (km)', key: 'distance', width: 16 },
        { header: 'Vel. Média (km/h)', key: 'avg', width: 18 },
        { header: 'Vel. Máx (km/h)', key: 'max', width: 18 },
      ];
      trips.forEach((t) =>
        sheet.addRow({ start: t.startTime, end: t.endTime, duration: t.duration, distance: t.distance, avg: t.avgSpeed, max: t.maxSpeed }),
      );
    } else {
      const stops = await this.getStops(deviceId, from, to);
      sheet.columns = [
        { header: 'Endereço', key: 'address', width: 40 },
        { header: 'Início', key: 'start', width: 22 },
        { header: 'Fim', key: 'end', width: 22 },
        { header: 'Duração (min)', key: 'duration', width: 14 },
      ];
      stops.forEach((s) =>
        sheet.addRow({ address: s.address, start: s.startTime, end: s.endTime, duration: s.duration }),
      );
    }

    // Estilizar header
    sheet.getRow(1).font = { bold: true };

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  exportCsv(
    rows: Record<string, unknown>[],
    headers: string[],
  ): string {
    const lines = [headers.join(',')];
    rows.forEach((row) => {
      lines.push(headers.map((h) => `"${String(row[h] ?? '')}"`).join(','));
    });
    return lines.join('\n');
  }

  private calculateDistance(positions: TraccarPosition[]): number {
    let total = 0;
    for (let i = 1; i < positions.length; i++) {
      total += this.haversine(
        positions[i - 1].latitude,
        positions[i - 1].longitude,
        positions[i].latitude,
        positions[i].longitude,
      );
    }
    return total;
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
