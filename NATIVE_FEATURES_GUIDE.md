# Native Capacitor Features Guide

This guide explains how to use native app features in your iCalc APK build. These features leverage Capacitor plugins for native device access.

## Available Native Features

### 1. **Camera** — Scan QR Codes & Capture Photos
**Files:** `utils/nativeCamera.ts`, `hooks/useNativeFeatures.ts`

**Use Cases:**
- Scan QR codes on products or invoices
- Capture receipt photos for documentation
- Pick photos from device gallery

**Usage in React:**
```tsx
import { useNativeFeatures } from './hooks/useNativeFeatures';

export function ProductScanner() {
  const { camera } = useNativeFeatures();

  const handleScan = async () => {
    const result = await camera.scanQRCode();
    if (result.success) {
      console.log('QR data:', result.data);
    }
  };

  return (
    <button onClick={handleScan}>
      Scan QR Code
    </button>
  );
}
```

---

### 2. **Share** — Share Invoices & Receipts
**Files:** `utils/nativeShare.ts`

**Use Cases:**
- Share invoices via email, messaging, AirDrop
- Share receipt photos with customers
- Native OS share sheet (better UX)

**Usage:**
```tsx
const { share, toast } = useNativeFeatures();

const handleShareInvoice = async () => {
  const invoiceText = `Invoice #123\nTotal: ₦50,000`;
  const result = await share.shareInvoice('Invoice #123', invoiceText, '₦50,000');
  
  if (result.success) {
    await toast.showSuccessToast('Invoice shared');
  }
};
```

---

### 3. **Network Status** — Detect Online/Offline
**Files:** `utils/nativeNetwork.ts`

**Use Cases:**
- Show offline indicator in UI
- Pause sync when on metered connection
- Sync automatically when back online
- Show user connection status

**Usage:**
```tsx
const { networkStatus, isOnline, isOnMeteredConnection } = useNativeFeatures({
  onNetworkStatusChange: (status) => {
    console.log('Connected:', status.isConnected);
    console.log('Type:', status.connectionType); // 'wifi' | 'cellular' | 'none'
  }
});

// Check current status
const online = await isOnline();
const metered = await isOnMeteredConnection();
```

---

### 4. **Haptics** — Vibration Feedback
**Files:** `utils/nativeHaptics.ts`

**Use Cases:**
- Enhance button feedback
- Confirm important actions
- Success/error notifications
- Selection feedback

**Built-in Patterns:**
```tsx
const { haptics } = useNativeFeatures();

// Simple vibration
await haptics.vibrate(50);

// Patterns
await haptics.hapticSuccess();    // ✓ Success feedback
await haptics.hapticError();      // ✗ Error feedback
await haptics.hapticWarning();    // ⚠ Warning feedback
await haptics.hapticDoubleTap();  // Confirm action

// Custom
await haptics.hapticImpact('heavy');
```

---

### 5. **Filesystem** — Backup & Export Data
**Files:** `utils/nativeFilesystem.ts`

**Use Cases:**
- Export inventory as JSON backup
- Export invoices as CSV for accounting
- Create full app backup
- Import data from files
- Save crash logs

**Usage:**
```tsx
const { filesystem, toast } = useNativeFeatures();

// Backup inventory
const result = await filesystem.exportInventoryAsFile(items);
if (result.success) {
  await toast.showSuccessToast(`Backup saved: ${result.path}`);
}

// Export invoice as CSV
await filesystem.exportInvoiceAsCSV('Invoice #1', items, total);

// Full backup
const backup = {
  settings, inventory, purchases, invoices
};
await filesystem.exportFullBackup(backup);

// List backups
const files = await filesystem.listBackupFiles();
```

---

### 6. **Toast Notifications** — Native Status Messages
**Files:** `utils/nativeToast.ts`

**Use Cases:**
- Show sync status
- Confirm actions
- Display errors with better UX
- Network status changes

**Usage:**
```tsx
const { toast } = useNativeFeatures();

// Simple message
await toast.showToast('Processing...');

// Pre-built messages
await toast.showSuccessToast('Inventory updated');
await toast.showErrorToast('Sync failed');
await toast.showWarningToast('Low stock alert');

// Specific feedback
await toast.showInvoiceToast('saved');      // ✓ Invoice saved
await toast.showInventoryToast('added');    // ✓ Item added
await toast.showSyncToast('success');       // ✓ Synced successfully
await toast.showConnectionToast(true);      // 🌐 Back online
```

---

## Complete Example: Enhanced Invoice Sharing

```tsx
import { useNativeFeatures } from './hooks/useNativeFeatures';

export function InvoiceCard({ invoice }) {
  const { share, haptics, toast, networkStatus } = useNativeFeatures();

  const handleShare = async () => {
    try {
      // Haptic feedback
      await haptics.hapticImpact('medium');

      // Check connection
      if (!networkStatus.isConnected) {
        await toast.showWarningToast('Offline - share may fail');
      }

      // Share invoice
      const text = `Invoice ${invoice.name}\nTotal: ${invoice.total}`;
      const result = await share.shareInvoice(
        invoice.name,
        text,
        invoice.total
      );

      if (result.success) {
        await haptics.hapticSuccess();
        await toast.showInvoiceToast('shared');
      } else {
        await haptics.hapticError();
        await toast.showErrorToast('Failed to share');
      }
    } catch (error) {
      await toast.showErrorToast('Sharing error');
    }
  };

  return (
    <button onClick={handleShare}>
      Share Invoice
    </button>
  );
}
```

---

## Component Integration Checklist

- [ ] Add `useNativeFeatures` to components that need native features
- [ ] Replace `console.log` errors with `showErrorToast`
- [ ] Add haptic feedback to important actions
- [ ] Show network status indicator
- [ ] Implement offline sync queue
- [ ] Add backup/export buttons to settings
- [ ] Test on actual device (emulator doesn't support all features)

---

## Testing Native Features

### On Android Emulator
```bash
npm run mobile:android
```

**Note:** Some features require actual device:
- Camera/QR scanning ✓ (works on emulator)
- Haptics/Vibration ✗ (no vibrator on emulator)
- Network status ✓
- Filesystem ✓
- Share ✓ (limited on emulator)

### On Real Device
```bash
# Build debug APK
npm run mobile:android:build

# Install on device
adb install android/app/release/app-release.apk
```

---

## Permissions Required

These are automatically handled by Capacitor, but ensure they're requested:

**Android (`android/app/src/main/AndroidManifest.xml`):**
```xml
<!-- Camera -->
<uses-permission android:name="android.permission.CAMERA" />

<!-- Storage -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

<!-- Network -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Vibration -->
<uses-permission android:name="android.permission.VIBRATE" />
```

---

## Performance Tips

1. **Camera**: Use low quality (85) for faster capture
2. **Network**: Cache connection status, don't check constantly
3. **Haptics**: Respect user settings (check if enabled first)
4. **Filesystem**: Limit backup frequency (once per day)
5. **Toast**: Don't spam messages, max 2-3 per action

---

## Error Handling

All native features fail gracefully:

```tsx
try {
  await camera.scanQRCode();
} catch (error) {
  await toast.showErrorToast('Camera not available');
}
```

Features return success/error objects - always check `result.success`.

---

## Next Steps

1. ✅ Plugins installed in `package.json`
2. ✅ Utility files created
3. ✅ React hook ready
4. **→ Next:** Add to UI components (invoice sharing, network indicator, etc.)
5. **→ Then:** Test on Android device
6. **→ Finally:** Release APK to Play Store

---

## References

- Capacitor Docs: https://capacitorjs.com/docs
- Plugin Docs: https://capacitorjs.com/docs/plugins
- Android Permissions: https://developer.android.com/guide/topics/permissions
