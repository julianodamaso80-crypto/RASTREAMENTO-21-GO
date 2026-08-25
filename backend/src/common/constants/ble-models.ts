/**
 * Modelos de equipamento que são TAG Bluetooth, não rastreador GPS.
 *
 * A distinção importa nas listas: um veículo tem um equipamento só
 * (`Device.vehicleId` é único), então quem está com TAG não está com
 * rastreador. "Clientes Ativos" é a lista de quem tem rastreador; TAG vive na
 * lista própria — misturar as duas faria o total de frota monitorada por GPS
 * mentir.
 */
export const BLE_DEVICE_MODELS = [
  'BLE_KTAG',
  'BLE_REDTAG',
  'BLE_AIRTAG_GENERIC',
] as const;
