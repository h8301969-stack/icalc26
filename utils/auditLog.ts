import { AuditLogEntry } from '../types';
import { supabase, isCloudBackendEnabled } from './supabase';

export const logAuditEntry = async (
  userId: string,
  entry: Omit<AuditLogEntry, 'id'>
): Promise<void> => {
  if (!isCloudBackendEnabled()) return;

  const id = crypto.randomUUID();
  const auditEntry = {
    id,
    user_id: userId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    profile_name: entry.profileName || null,
    timestamp: entry.timestamp,
    details: entry.details || null,
  };

  const { error } = await supabase.from('audit_logs').insert([auditEntry]);
  if (error) {
    console.error('[iCalc audit] Failed to log entry:', error);
  }
};

export const fetchAuditLogsForEntity = async (
  userId: string,
  entityType: string,
  entityId: string
): Promise<AuditLogEntry[]> => {
  if (!isCloudBackendEnabled()) return [];

  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('[iCalc audit] Failed to fetch logs:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    profileName: row.profile_name || undefined,
    timestamp: row.timestamp,
    details: row.details || undefined,
  }));
};

export const fetchAllAuditLogs = async (
  userId: string,
  limit = 100
): Promise<AuditLogEntry[]> => {
  if (!isCloudBackendEnabled()) return [];

  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[iCalc audit] Failed to fetch all logs:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    profileName: row.profile_name || undefined,
    timestamp: row.timestamp,
    details: row.details || undefined,
  }));
};
