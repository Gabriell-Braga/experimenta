// SDK React Native do Experimenta: flags, campanhas server-side e eventos no app. Ver docs/SDK-MOBILE.md.
import { AppState, Dimensions, Platform } from 'react-native';
import { createMobileClient, type DeviceInfo, type MobileClientOptions } from './client';

export * from './client';
export * from './react';

/** Plataforma, versão do SO, celular/tablet (menor lado ≥ 600 dp ou iPad) e largura da janela. */
export function readDevice(): DeviceInfo {
  const { width, height } = Dimensions.get('window');
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    type: Platform.isPad || Math.min(width, height) >= 600 ? 'tablet' : 'mobile',
    width,
  };
}

/**
 * Cria o cliente com o AppState (envio ao ir para o background) e os dados do aparelho. Passe o AsyncStorage em
 * `storage` para guardar visitante, atribuições e fila offline entre aberturas.
 */
export const createClient = (o: MobileClientOptions) =>
  createMobileClient({ appState: AppState, device: readDevice(), ...o });
