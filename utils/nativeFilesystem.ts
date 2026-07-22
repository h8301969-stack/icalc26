/**
 * Native filesystem access for backup, export, and import
 * Uses Capacitor Filesystem plugin for native file operations
 * Allows saving inventory, invoices, and settings to device storage
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Export inventory data as JSON file
 */
export const exportInventoryAsFile = async (
  inventory: any[],
  fileName: string = `inventory-${Date.now()}.json`
): Promise<ExportResult> => {
  try {
    const data = JSON.stringify(inventory, null, 2);

    const result = await Filesystem.writeFile({
      path: fileName,
      data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });

    return {
      success: true,
      path: result.uri
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export inventory'
    };
  }
};

/**
 * Export all app data as comprehensive backup
 */
export const exportFullBackup = async (appData: any): Promise<ExportResult> => {
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const fileName = `icalc-backup-${timestamp}.json`;
    const data = JSON.stringify(appData, null, 2);

    const result = await Filesystem.writeFile({
      path: fileName,
      data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });

    return {
      success: true,
      path: result.uri
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create backup'
    };
  }
};

/**
 * Export invoice as text/CSV
 */
export const exportInvoiceAsCSV = async (
  invoiceName: string,
  items: any[],
  total: string
): Promise<ExportResult> => {
  try {
    let csv = 'Item,Quantity,Price,Total\n';
    items.forEach(item => {
      const itemTotal = (item.quantity * item.price).toFixed(2);
      csv += `"${item.name}",${item.quantity},${item.price.toFixed(2)},${itemTotal}\n`;
    });
    csv += `\nTotal:,,,${total}`;

    const fileName = `${invoiceName}-${Date.now()}.csv`;

    const result = await Filesystem.writeFile({
      path: fileName,
      data: csv,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });

    return {
      success: true,
      path: result.uri
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export invoice'
    };
  }
};

/**
 * Import data from JSON file
 */
export const importDataFromFile = async (fileName: string): Promise<ImportResult> => {
  try {
    const result = await Filesystem.readFile({
      path: fileName,
      directory: Directory.Documents,
      encoding: Encoding.UTF8
    });

    if (typeof result.data === 'string') {
      return {
        success: true,
        data: result.data
      };
    }

    return {
      success: false,
      error: 'Invalid file format'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import file'
    };
  }
};

/**
 * List all backup files in Documents
 */
export const listBackupFiles = async (): Promise<string[]> => {
  try {
    const result = await Filesystem.readdir({
      path: '',
      directory: Directory.Documents
    });

    return result.files
      .filter(file => file.name.includes('icalc-') || file.name.includes('backup'))
      .map(file => file.name);
  } catch (error) {
    console.error('Failed to list backup files:', error);
    return [];
  }
};

/**
 * Delete backup file
 */
export const deleteBackupFile = async (fileName: string): Promise<boolean> => {
  try {
    await Filesystem.deleteFile({
      path: fileName,
      directory: Directory.Documents
    });
    return true;
  } catch (error) {
    console.error('Failed to delete file:', error);
    return false;
  }
};

/**
 * Save crash log for debugging
 */
export const saveCrashLog = async (errorMessage: string): Promise<boolean> => {
  try {
    const timestamp = new Date().toISOString();
    const logData = `[${timestamp}] ${errorMessage}\n`;

    // Append to crash log file
    const fileName = 'crash-log.txt';
    try {
      const existing = await Filesystem.readFile({
        path: fileName,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
      const newData = existing.data + logData;
      await Filesystem.writeFile({
        path: fileName,
        data: newData,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
    } catch {
      // File doesn't exist, create it
      await Filesystem.writeFile({
        path: fileName,
        data: logData,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
    }

    return true;
  } catch (error) {
    console.error('Failed to save crash log:', error);
    return false;
  }
};
