'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { client } from '@/client/client.gen';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import CsvUploadSelector from './CsvUploadSelector';

interface ContactSourceSelectorProps {
  sourceType: string;
  onSourceTypeChange: (type: string) => void;
  sourceId: string;
  onSourceIdChange: (id: string) => void;
  sourceConfig: Record<string, any>;
  onSourceConfigChange: (config: Record<string, any>) => void;
  autoSyncEnabled: boolean;
  onAutoSyncEnabledChange: (enabled: boolean) => void;
  autoSyncIntervalMinutes: number;
  onAutoSyncIntervalMinutesChange: (interval: number) => void;
  autoSyncOnlyNew: boolean;
  onAutoSyncOnlyNewChange: (onlyNew: boolean) => void;
  getAccessToken: () => Promise<string>;
}

interface CRMCredential {
  id: number;
  provider: string;
  name: string;
  is_active: boolean;
}

export default function ContactSourceSelector({
  sourceType,
  onSourceTypeChange,
  sourceId,
  onSourceIdChange,
  sourceConfig,
  onSourceConfigChange,
  autoSyncEnabled,
  onAutoSyncEnabledChange,
  autoSyncIntervalMinutes,
  onAutoSyncIntervalMinutesChange,
  autoSyncOnlyNew,
  onAutoSyncOnlyNewChange,
  getAccessToken,
}: ContactSourceSelectorProps) {
  const [credentials, setCredentials] = useState<CRMCredential[]>([]);
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    headers?: string[];
    rowsCount?: number;
    errorMessage?: string;
  } | null>(null);

  // New credential form state
  const [showNewCredForm, setShowNewCredForm] = useState(false);
  const [newCredName, setNewCredName] = useState('');
  const [isSavingCred, setIsSavingCred] = useState(false);

  // Specific CRM details
  const [hubspotToken, setHubspotToken] = useState('');
  const [salesforceToken, setSalesforceToken] = useState('');
  const [salesforceUrl, setSalesforceUrl] = useState('https://login.salesforce.com');
  const [zohoToken, setZohoToken] = useState('');
  const [zohoClientId, setZohoClientId] = useState('');
  const [zohoClientSecret, setZohoClientSecret] = useState('');
  const [zohoRefreshToken, setZohoRefreshToken] = useState('');
  const [zohoAccountsUrl, setZohoAccountsUrl] = useState('https://accounts.zoho.com');
  const [zohoApiDomain, setZohoApiDomain] = useState('https://www.zohoapis.com');

  // Load existing credentials
  const fetchCredentials = useCallback(async () => {
    setIsLoadingCredentials(true);
    try {
      const token = await getAccessToken();
      const response = await client.get({
        url: '/api/v1/crm-credentials',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.data) {
        setCredentials(response.data as CRMCredential[]);
      }
    } catch (error) {
      console.error('Failed to load CRM credentials:', error);
    } finally {
      setIsLoadingCredentials(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (['hubspot', 'zoho_crm', 'salesforce'].includes(sourceType)) {
      fetchCredentials();
    }
    setValidationResult(null);
  }, [sourceType, fetchCredentials]);

  // Set default config values when sourceType changes
  const handleSourceTypeChange = (value: string) => {
    onSourceTypeChange(value);
    onSourceIdChange('');
    setValidationResult(null);
    setShowNewCredForm(false);

    if (value === 'csv') {
      onSourceConfigChange({});
    } else if (value === 'google_sheets') {
      onSourceConfigChange({
        spreadsheet_id: '',
        range_name: 'Sheet1!A:Z',
        auth_type: 'public',
        api_key: '',
        service_account_json: '',
        phone_column: 'phone_number',
      });
    } else if (value === 'api_endpoint') {
      onSourceConfigChange({
        url: '',
        method: 'GET',
        auth_type: 'none',
        token: '',
        username: '',
        password: '',
        header_name: '',
        api_key: '',
        json_path: '',
        phone_property: 'phone_number',
        pagination_type: 'none',
        page_param: 'page',
        start_page: 1,
        limit: 50,
        limit_param: 'limit',
      });
    } else if (value === 'hubspot') {
      onSourceConfigChange({
        credential_id: '',
        list_id: '',
        phone_property: 'phone',
        extra_properties: [],
      });
    } else if (value === 'zoho_crm') {
      onSourceConfigChange({
        credential_id: '',
        module: 'Leads',
        phone_field: 'Phone',
        view_id: '',
        api_domain: 'https://www.zohoapis.com',
      });
    } else if (value === 'salesforce') {
      onSourceConfigChange({
        credential_id: '',
        phone_field: 'Phone',
        soql_query: '',
        instance_url: 'https://login.salesforce.com',
      });
    }
  };

  const handleConfigChange = (key: string, value: any) => {
    const updated = { ...sourceConfig, [key]: value };
    onSourceConfigChange(updated);
    if (key === 'spreadsheet_id' && sourceType === 'google_sheets') {
      onSourceIdChange(value);
    } else if (key === 'url' && sourceType === 'api_endpoint') {
      onSourceIdChange(value);
    }
  };

  const handleSaveCredential = async () => {
    if (!newCredName.trim()) {
      toast.error('Credential name is required');
      return;
    }

    let credentials_data: Record<string, any> = {};
    if (sourceType === 'hubspot') {
      if (!hubspotToken) {
        toast.error('Access token is required');
        return;
      }
      credentials_data = { access_token: hubspotToken };
    } else if (sourceType === 'salesforce') {
      if (!salesforceToken) {
        toast.error('Access token is required');
        return;
      }
      credentials_data = {
        access_token: salesforceToken,
        instance_url: salesforceUrl,
      };
    } else if (sourceType === 'zoho_crm') {
      if (!zohoToken && !zohoRefreshToken) {
        toast.error('Access token or Refresh token is required');
        return;
      }
      credentials_data = {
        access_token: zohoToken,
        client_id: zohoClientId,
        client_secret: zohoClientSecret,
        refresh_token: zohoRefreshToken,
        accounts_url: zohoAccountsUrl,
        api_domain: zohoApiDomain,
      };
    }

    setIsSavingCred(true);
    try {
      const token = await getAccessToken();
      const response = await client.post({
        url: '/api/v1/crm-credentials',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: {
          provider: sourceType,
          name: newCredName,
          credentials_data,
        },
      });

      if (response.error) {
        throw new Error(String(response.error ?? 'Failed to save credential'));
      }

      toast.success('CRM credential saved successfully');
      setNewCredName('');
      setHubspotToken('');
      setSalesforceToken('');
      setZohoToken('');
      setZohoClientId('');
      setZohoClientSecret('');
      setZohoRefreshToken('');
      setShowNewCredForm(false);
      
      // Reload lists and select the newly created credential
      await fetchCredentials();
      const responseData = response.data as any;
      if (responseData && typeof responseData === 'object' && 'id' in responseData) {
        const credId = String(responseData.id);
        handleConfigChange('credential_id', credId);
        onSourceIdChange(credId);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save credential');
    } finally {
      setIsSavingCred(false);
    }
  };

  const handleValidateConnection = async () => {
    setValidationResult(null);
    setIsValidating(true);

    try {
      const token = await getAccessToken();
      const response = await client.post({
        url: '/api/v1/campaign/validate-source',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: {
          source_type: sourceType,
          source_id: sourceId || 'test_source',
          source_config: sourceConfig,
        },
      });

      if (response.data) {
        const res = response.data as any;
        setValidationResult({
          isValid: res.is_valid,
          headers: res.headers,
          rowsCount: res.rows_count,
          errorMessage: res.error_message,
        });

        if (res.is_valid) {
          toast.success(`Connection verified! Found ${res.rows_count} rows.`);
        } else {
          toast.error(res.error_message || 'Validation failed');
        }
      }
    } catch (err: any) {
      setValidationResult({
        isValid: false,
        errorMessage: err.message || 'Connection request failed',
      });
      toast.error(err.message || 'Failed to validate source connection');
    } finally {
      setIsValidating(false);
    }
  };

  const filteredCredentials = credentials.filter((c) => c.provider === sourceType);

  return (
    <div className="space-y-6 text-white">
      {/* 1. Source Type Selector */}
      <div className="space-y-2">
        <Label htmlFor="source-type" className="text-xs font-semibold text-zinc-300">Data Source Type</Label>
        <Select value={sourceType} onValueChange={handleSourceTypeChange} required>
          <SelectTrigger id="source-type" className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
            <SelectValue placeholder="Select source type" />
          </SelectTrigger>
          <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
            <SelectItem value="csv" className="text-xs">CSV File</SelectItem>
            <SelectItem value="google_sheets" className="text-xs">Google Sheets</SelectItem>
            <SelectItem value="api_endpoint" className="text-xs">Custom API Endpoint</SelectItem>
            <SelectItem value="hubspot" className="text-xs">HubSpot CRM</SelectItem>
            <SelectItem value="zoho_crm" className="text-xs">Zoho CRM</SelectItem>
            <SelectItem value="salesforce" className="text-xs">Salesforce CRM</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-zinc-500">
          Choose where your contact data is stored
        </p>
      </div>

      {/* 2. Source-Specific Configuration Fields */}
      {sourceType === 'csv' && (
        <CsvUploadSelector
          onFileUploaded={(key, name) => {
            onSourceIdChange(key);
          }}
          selectedFileName={sourceId ? 'Uploaded File' : ''}
        />
      )}

      {sourceType === 'google_sheets' && (
        <Card className="bg-[#111113] border-[#1d1d22] rounded-2xl shadow-none">
          <CardHeader className="py-4 border-b border-[#1d1d22]/50">
            <CardTitle className="text-sm font-bold text-white">Google Sheets Configuration</CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              Fetch contacts dynamically from a spreadsheet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Spreadsheet ID</Label>
              <Input
                placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgpFD5mdLTuxaFFVLK2U0"
                value={sourceConfig.spreadsheet_id || ''}
                onChange={(e) => handleConfigChange('spreadsheet_id', e.target.value)}
                required
                className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
              />
              <p className="text-[11px] text-zinc-500">
                Found in the spreadsheet URL: https://docs.google.com/spreadsheets/d/{"<Spreadsheet ID>"}/edit
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Range Name</Label>
              <Input
                placeholder="e.g. Sheet1!A:Z"
                value={sourceConfig.range_name || ''}
                onChange={(e) => handleConfigChange('range_name', e.target.value)}
                className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
              />
              <p className="text-[11px] text-zinc-500">
                The sheet name and column range to sync from
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Authorization Type</Label>
              <Select
                value={sourceConfig.auth_type || 'public'}
                onValueChange={(val) => handleConfigChange('auth_type', val)}
              >
                <SelectTrigger className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                  <SelectItem value="public" className="text-xs">Public (Shared spreadsheet + API Key)</SelectItem>
                  <SelectItem value="service_account" className="text-xs">Google Service Account JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceConfig.auth_type === 'public' ? (
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Google Sheets API Key</Label>
                <Input
                  type="password"
                  placeholder="Enter API Key"
                  value={sourceConfig.api_key || ''}
                  onChange={(e) => handleConfigChange('api_key', e.target.value)}
                  className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Service Account JSON Credentials</Label>
                <Textarea
                  placeholder="Paste service account JSON contents here"
                  className="font-mono text-xs h-32 bg-[#08080a] border-[#1d1d22] text-white rounded-xl focus-visible:ring-[#7c3aed]"
                  value={sourceConfig.service_account_json || ''}
                  onChange={(e) => handleConfigChange('service_account_json', e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Phone Number Column</Label>
              <Input
                placeholder="phone_number"
                value={sourceConfig.phone_column || 'phone_number'}
                onChange={(e) => handleConfigChange('phone_column', e.target.value)}
                className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
              />
              <p className="text-[11px] text-zinc-500">
                Name of the column containing the recipient phone numbers
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {sourceType === 'api_endpoint' && (
        <Card className="bg-[#111113] border-[#1d1d22] rounded-2xl shadow-none">
          <CardHeader className="py-4 border-b border-[#1d1d22]/50">
            <CardTitle className="text-sm font-bold text-white">API Endpoint Configuration</CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              Fetch contacts from a custom JSON API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Endpoint URL</Label>
              <Input
                placeholder="https://api.yourdomain.com/v1/contacts"
                value={sourceConfig.url || ''}
                onChange={(e) => handleConfigChange('url', e.target.value)}
                required
                className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">HTTP Method</Label>
                <Select
                  value={sourceConfig.method || 'GET'}
                  onValueChange={(val) => handleConfigChange('method', val)}
                >
                  <SelectTrigger className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                    <SelectItem value="GET" className="text-xs">GET</SelectItem>
                    <SelectItem value="POST" className="text-xs">POST</SelectItem>
                    <SelectItem value="PUT" className="text-xs">PUT</SelectItem>
                    <SelectItem value="PATCH" className="text-xs">PATCH</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Authentication Type</Label>
                <Select
                  value={sourceConfig.auth_type || 'none'}
                  onValueChange={(val) => handleConfigChange('auth_type', val)}
                >
                  <SelectTrigger className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                    <SelectItem value="none" className="text-xs">None</SelectItem>
                    <SelectItem value="bearer" className="text-xs">Bearer Token</SelectItem>
                    <SelectItem value="basic" className="text-xs">Basic Auth</SelectItem>
                    <SelectItem value="api_key" className="text-xs">API Key (Header)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sourceConfig.auth_type === 'bearer' && (
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Token</Label>
                <Input
                  type="password"
                  placeholder="Bearer Token"
                  value={sourceConfig.token || ''}
                  onChange={(e) => handleConfigChange('token', e.target.value)}
                  className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                />
              </div>
            )}

            {sourceConfig.auth_type === 'basic' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Username</Label>
                  <Input
                    placeholder="Username"
                    value={sourceConfig.username || ''}
                    onChange={(e) => handleConfigChange('username', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Password</Label>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={sourceConfig.password || ''}
                    onChange={(e) => handleConfigChange('password', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </div>
            )}

            {sourceConfig.auth_type === 'api_key' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Header Name</Label>
                  <Input
                    placeholder="X-API-Key"
                    value={sourceConfig.header_name || ''}
                    onChange={(e) => handleConfigChange('header_name', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">API Key</Label>
                  <Input
                    type="password"
                    placeholder="API Key Value"
                    value={sourceConfig.api_key || ''}
                    onChange={(e) => handleConfigChange('api_key', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">JSON Path to List</Label>
                <Input
                  placeholder="e.g. data.contacts (leave empty if root list)"
                  value={sourceConfig.json_path || ''}
                  onChange={(e) => handleConfigChange('json_path', e.target.value)}
                  className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Phone Property Name</Label>
                <Input
                  placeholder="phone_number"
                  value={sourceConfig.phone_property || 'phone_number'}
                  onChange={(e) => handleConfigChange('phone_property', e.target.value)}
                  className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">Pagination Type</Label>
              <Select
                value={sourceConfig.pagination_type || 'none'}
                onValueChange={(val) => handleConfigChange('pagination_type', val)}
              >
                <SelectTrigger className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                  <SelectItem value="none" className="text-xs">No Pagination</SelectItem>
                  <SelectItem value="page" className="text-xs">Page-Based (page & limit)</SelectItem>
                  <SelectItem value="offset" className="text-xs">Offset-Based (offset & limit)</SelectItem>
                  <SelectItem value="cursor" className="text-xs">Cursor-Based</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {sourceConfig.pagination_type === 'page' && (
              <div className="grid grid-cols-4 gap-2 bg-[#08080a]/50 p-3 rounded-xl border border-[#1d1d22]">
                <div className="col-span-2 space-y-1">
                  <Label className="text-[10px] text-zinc-400">Page Param</Label>
                  <Input
                    value={sourceConfig.page_param || 'page'}
                    onChange={(e) => handleConfigChange('page_param', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Start Page</Label>
                  <Input
                    type="number"
                    value={sourceConfig.start_page ?? 1}
                    onChange={(e) => handleConfigChange('start_page', parseInt(e.target.value) || 1)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Limit</Label>
                  <Input
                    type="number"
                    value={sourceConfig.limit ?? 50}
                    onChange={(e) => handleConfigChange('limit', parseInt(e.target.value) || 50)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </div>
            )}

            {sourceConfig.pagination_type === 'offset' && (
              <div className="grid grid-cols-4 gap-2 bg-[#08080a]/50 p-3 rounded-xl border border-[#1d1d22]">
                <div className="col-span-2 space-y-1">
                  <Label className="text-[10px] text-zinc-400">Offset Param</Label>
                  <Input
                    value={sourceConfig.offset_param || 'offset'}
                    onChange={(e) => handleConfigChange('offset_param', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Start Offset</Label>
                  <Input
                    type="number"
                    value={sourceConfig.start_offset ?? 0}
                    onChange={(e) => handleConfigChange('start_offset', parseInt(e.target.value) || 0)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Limit</Label>
                  <Input
                    type="number"
                    value={sourceConfig.limit ?? 50}
                    onChange={(e) => handleConfigChange('limit', parseInt(e.target.value) || 50)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </div>
            )}

            {sourceConfig.pagination_type === 'cursor' && (
              <div className="grid grid-cols-3 gap-2 bg-[#08080a]/50 p-3 rounded-xl border border-[#1d1d22]">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Cursor Param</Label>
                  <Input
                    value={sourceConfig.cursor_param || 'cursor'}
                    onChange={(e) => handleConfigChange('cursor_param', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Cursor Path</Label>
                  <Input
                    value={sourceConfig.cursor_path || 'next_cursor'}
                    onChange={(e) => handleConfigChange('cursor_path', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Limit</Label>
                  <Input
                    type="number"
                    value={sourceConfig.limit ?? 50}
                    onChange={(e) => handleConfigChange('limit', parseInt(e.target.value) || 50)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-8 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {['hubspot', 'zoho_crm', 'salesforce'].includes(sourceType) && (
        <Card className="bg-[#111113] border-[#1d1d22] rounded-2xl shadow-none">
          <CardHeader className="py-4 border-b border-[#1d1d22]/50">
            <CardTitle className="text-sm font-bold text-white capitalize">{sourceType.replace('_', ' ')} Settings</CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              Link this campaign to your CRM organization data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {/* Credential Selector */}
            <div className="space-y-2">
              <Label className="text-xs text-zinc-300">CRM Credential</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select
                    value={sourceConfig.credential_id || ''}
                    onValueChange={(val) => {
                      handleConfigChange('credential_id', val);
                      onSourceIdChange(val);
                    }}
                    disabled={isLoadingCredentials}
                  >
                    <SelectTrigger className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus:ring-[#7c3aed]">
                      <SelectValue placeholder={isLoadingCredentials ? "Loading..." : "Select saved credential"} />
                    </SelectTrigger>
                    <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                      {filteredCredentials.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewCredForm(!showNewCredForm)}
                  className="border-[#1d1d22] hover:bg-[#1a1a1f] text-xs font-semibold rounded-xl text-white h-10 px-4"
                >
                  {showNewCredForm ? 'Cancel' : 'New Credential'}
                </Button>
              </div>
            </div>

            {/* In-place Add New Credential Form */}
            {showNewCredForm && (
              <div className="border border-dashed border-[#1d1d22] p-4 rounded-xl space-y-4 bg-[#08080a]/40">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#a78bfa]">
                  Add New {sourceType.replace('_', ' ')} Credential
                </h4>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-400">Credential Name</Label>
                  <Input
                    placeholder="e.g. Sales HubSpot Account"
                    value={newCredName}
                    onChange={(e) => setNewCredName(e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>

                {sourceType === 'hubspot' && (
                  <div className="space-y-2">
                    <Label className="text-xs text-zinc-400">Access Token</Label>
                    <Input
                      type="password"
                      placeholder="pat-na-..."
                      value={hubspotToken}
                      onChange={(e) => setHubspotToken(e.target.value)}
                      className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                    />
                  </div>
                )}

                {sourceType === 'salesforce' && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-400">Access Token</Label>
                      <Input
                        type="password"
                        placeholder="Salesforce Access Token"
                        value={salesforceToken}
                        onChange={(e) => setSalesforceToken(e.target.value)}
                        className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-400">Instance URL</Label>
                      <Input
                        placeholder="https://mycompany.my.salesforce.com"
                        value={salesforceUrl}
                        onChange={(e) => setSalesforceUrl(e.target.value)}
                        className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                      />
                    </div>
                  </>
                )}

                {sourceType === 'zoho_crm' && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-400">Access Token (Optional if refresh token is provided)</Label>
                      <Input
                        type="password"
                        placeholder="1000.xxxx..."
                        value={zohoToken}
                        onChange={(e) => setZohoToken(e.target.value)}
                        className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-400">Client ID</Label>
                        <Input
                          placeholder="Client ID"
                          value={zohoClientId}
                          onChange={(e) => setNewCredName(e.target.value)}
                          className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-9 focus-visible:ring-[#7c3aed]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-400">Client Secret</Label>
                        <Input
                          type="password"
                          placeholder="Client Secret"
                          value={zohoClientSecret}
                          onChange={(e) => setZohoClientSecret(e.target.value)}
                          className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-9 focus-visible:ring-[#7c3aed]"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-400">Refresh Token</Label>
                      <Input
                        type="password"
                        placeholder="Refresh Token"
                        value={zohoRefreshToken}
                        onChange={(e) => setZohoRefreshToken(e.target.value)}
                        className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-400">Accounts URL</Label>
                        <Input
                          value={zohoAccountsUrl}
                          onChange={(e) => setZohoAccountsUrl(e.target.value)}
                          className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-9 focus-visible:ring-[#7c3aed]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-400">API Domain</Label>
                        <Input
                          value={zohoApiDomain}
                          onChange={(e) => setZohoApiDomain(e.target.value)}
                          className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-lg h-9 focus-visible:ring-[#7c3aed]"
                        />
                      </div>
                    </div>
                  </>
                )}

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveCredential}
                  disabled={isSavingCred}
                  className="w-full mt-2 bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-10 rounded-xl"
                >
                  {isSavingCred ? 'Saving...' : 'Save & Select Credential'}
                </Button>
              </div>
            )}

            {/* HubSpot Configuration */}
            {sourceType === 'hubspot' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">List ID (Optional)</Label>
                  <Input
                    placeholder="Sync from a specific HubSpot list (e.g. 5)"
                    value={sourceConfig.list_id || ''}
                    onChange={(e) => handleConfigChange('list_id', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Phone Property Name</Label>
                  <Input
                    placeholder="phone"
                    value={sourceConfig.phone_property || 'phone'}
                    onChange={(e) => handleConfigChange('phone_property', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Extra Properties to Import (Comma-separated)</Label>
                  <Input
                    placeholder="firstname, lastname, email, city"
                    value={sourceConfig._extra_properties_raw || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      handleConfigChange('_extra_properties_raw', raw);
                      const parsed = raw.split(',').map((p) => p.trim()).filter(Boolean);
                      handleConfigChange('extra_properties', parsed);
                    }}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </>
            )}

            {/* Zoho CRM Configuration */}
            {sourceType === 'zoho_crm' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Module Name</Label>
                  <Input
                    placeholder="Leads"
                    value={sourceConfig.module || 'Leads'}
                    onChange={(e) => handleConfigChange('module', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Phone Field Name</Label>
                  <Input
                    placeholder="Phone"
                    value={sourceConfig.phone_field || 'Phone'}
                    onChange={(e) => handleConfigChange('phone_field', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Custom View ID (Optional)</Label>
                  <Input
                    placeholder="Custom view ID if filtering results"
                    value={sourceConfig.view_id || ''}
                    onChange={(e) => handleConfigChange('view_id', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
              </>
            )}

            {/* Salesforce Configuration */}
            {sourceType === 'salesforce' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">Phone Field Name</Label>
                  <Input
                    placeholder="Phone"
                    value={sourceConfig.phone_field || 'Phone'}
                    onChange={(e) => handleConfigChange('phone_field', e.target.value)}
                    className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-zinc-300">SOQL Query (Optional)</Label>
                  <Textarea
                    placeholder="SELECT Phone, FirstName, LastName FROM Contact WHERE DoNotCall = false"
                    className="font-mono text-xs h-24 bg-[#08080a] border-[#1d1d22] text-white rounded-xl focus-visible:ring-[#7c3aed]"
                    value={sourceConfig.soql_query || ''}
                    onChange={(e) => handleConfigChange('soql_query', e.target.value)}
                  />
                  <p className="text-[10px] text-zinc-500">
                    If omitted, the fetcher will select default phone fields from active Contacts.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3. Real-time Connection Validator */}
      {sourceType !== 'csv' && (
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full border-[#1d1d22] hover:bg-[#1a1a1f] text-xs font-semibold rounded-xl text-white h-10"
            onClick={handleValidateConnection}
            disabled={isValidating}
          >
            {isValidating ? 'Validating Connection...' : 'Validate Source Connection'}
          </Button>

          {validationResult && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                validationResult.isValid
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}
            >
              {validationResult.isValid ? (
                <div>
                  <p className="font-semibold">Connection verified successfully!</p>
                  <p className="text-[11px] mt-1 text-zinc-300">
                    Found <strong className="font-bold">{validationResult.rowsCount}</strong> records.
                  </p>
                  {validationResult.headers && validationResult.headers.length > 0 && (
                    <p className="text-[10px] mt-1 text-zinc-500 font-mono">
                      Headers: {validationResult.headers.join(', ')}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="font-semibold">Connection failed</p>
                  <p className="text-[11px] mt-1 text-zinc-300">{validationResult.errorMessage || 'Invalid settings or authorization'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Automated Synchronization Settings */}
      {sourceType !== 'csv' && (
        <Card className="bg-[#111113] border-[#1d1d22] rounded-2xl shadow-none">
          <CardHeader className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-white">Automated Background Sync</CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                  Keep campaign contacts in sync with the live source
                </CardDescription>
              </div>
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={onAutoSyncEnabledChange}
                className="data-[state=checked]:bg-[#7c3aed]"
              />
            </div>
          </CardHeader>
          {autoSyncEnabled && (
            <CardContent className="space-y-4 pt-4 border-t border-[#1d1d22]/50">
              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">Sync Interval (Minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={autoSyncIntervalMinutes}
                  onChange={(e) => onAutoSyncIntervalMinutesChange(parseInt(e.target.value) || 60)}
                  className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                />
                <p className="text-[11px] text-zinc-500">
                  How often to pull updates from the data source
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="space-y-0.5">
                  <Label className="text-xs text-zinc-300">Sync Only New Contacts</Label>
                  <p className="text-[11px] text-zinc-500">
                    Only enqueue new contacts, avoiding duplicates
                  </p>
                </div>
                <Switch
                  checked={autoSyncOnlyNew}
                  onCheckedChange={onAutoSyncOnlyNewChange}
                  className="data-[state=checked]:bg-[#7c3aed]"
                />
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
