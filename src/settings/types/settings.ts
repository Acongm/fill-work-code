export interface RuntimeConfiguration {
  storagePath: string;
  storagePathResolved: string;
  autoSave: boolean;
  previewEnabled: boolean;
}

export interface PluginSecretUpdates {
  apiKey?: string;
  emailPassword?: string;
}
