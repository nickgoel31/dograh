"use client";

import { AlertTriangle, Code2, Copy, Eye, EyeOff, Key, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
    archiveApiKeyApiV1UserApiKeysApiKeyIdDelete,
    archiveServiceKeyApiV1UserServiceKeysServiceKeyIdDelete,
    createApiKeyApiV1UserApiKeysPost,
    createServiceKeyApiV1UserServiceKeysPost,
    getApiKeysApiV1UserApiKeysGet,
    getServiceKeysApiV1UserServiceKeysGet,
    reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut
} from '@/client/sdk.gen';
import type { ApiKeyResponse, CreateApiKeyResponse, CreateServiceKeyResponse, ServiceKeyResponse } from '@/client/types.gen';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppConfig } from '@/context/AppConfigContext';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';

export default function APIKeysPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const { config } = useAppConfig();
    const isOSS = config?.deploymentMode === 'oss';

    logger.debug('[APIKeysPage] Component render', {
        loading,
        hasUser: !!user,
        userId: user?.id,
        timestamp: new Date().toISOString()
    });

    const [apiKeys, setApiKeys] = useState<ApiKeyResponse[]>([]);
    const [serviceKeys, setServiceKeys] = useState<ServiceKeyResponse[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isServiceKeysLoading, setIsServiceKeysLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [showServiceArchived, setShowServiceArchived] = useState(false);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isCreateServiceDialogOpen, setIsCreateServiceDialogOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newServiceKeyName, setNewServiceKeyName] = useState('');
    const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
    const [createdServiceKey, setCreatedServiceKey] = useState<CreateServiceKeyResponse | null>(null);
    const [showCreatedKeyDialog, setShowCreatedKeyDialog] = useState(false);
    const [showCreatedServiceKeyDialog, setShowCreatedServiceKeyDialog] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchApiKeys = useCallback(async () => {
        if (loading || !user) return;

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await getApiKeysApiV1UserApiKeysGet({
                query: {
                    include_archived: showArchived
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setApiKeys(response.data);
            }
        } catch (err) {
            setError('Failed to fetch API keys');
            console.error('Error fetching API keys:', err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, getAccessToken, showArchived]);

    const fetchServiceKeys = useCallback(async () => {
        if (loading || !user) return;

        try {
            setIsServiceKeysLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await getServiceKeysApiV1UserServiceKeysGet({
                query: {
                    include_archived: showServiceArchived
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setServiceKeys(response.data);
            }
        } catch (err) {
            setError('Failed to fetch service keys');
            console.error('Error fetching service keys:', err);
        } finally {
            setIsServiceKeysLoading(false);
        }
    }, [loading, user, getAccessToken, showServiceArchived]);

    useEffect(() => {
        fetchApiKeys();
    }, [fetchApiKeys]);

    useEffect(() => {
        fetchServiceKeys();
    }, [fetchServiceKeys]);

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) {
            setError('Please enter a name for the API key');
            return;
        }

        try {
            setError(null);
            const accessToken = await getAccessToken();

            const response = await createApiKeyApiV1UserApiKeysPost({
                body: {
                    name: newKeyName
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCreatedKey(response.data);
                setIsCreateDialogOpen(false);
                setShowCreatedKeyDialog(true);
                setNewKeyName('');
                fetchApiKeys();
            }
        } catch (err) {
            setError('Failed to create API key');
            console.error('Error creating API key:', err);
        }
    };

    const handleCreateServiceKey = async () => {
        if (!newServiceKeyName.trim()) {
            setError('Please enter a name for the service key');
            return;
        }

        try {
            setError(null);
            const accessToken = await getAccessToken();

            const response = await createServiceKeyApiV1UserServiceKeysPost({
                body: {
                    name: newServiceKeyName,
                    expires_in_days: 90
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCreatedServiceKey(response.data);
                setIsCreateServiceDialogOpen(false);
                setShowCreatedServiceKeyDialog(true);
                setNewServiceKeyName('');
                fetchServiceKeys();
            }
        } catch (err) {
            setError('Failed to create service key');
            console.error('Error creating service key:', err);
        }
    };

    const handleArchiveKey = async (keyId: number) => {
        try {
            setError(null);
            const accessToken = await getAccessToken();

            await archiveApiKeyApiV1UserApiKeysApiKeyIdDelete({
                path: {
                    api_key_id: keyId
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            fetchApiKeys();
        } catch (err) {
            setError('Failed to archive API key');
            console.error('Error archiving API key:', err);
        }
    };

    const handleArchiveServiceKey = async (keyId: string) => {
        try {
            setError(null);
            const accessToken = await getAccessToken();

            await archiveServiceKeyApiV1UserServiceKeysServiceKeyIdDelete({
                path: {
                    service_key_id: keyId
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            fetchServiceKeys();
        } catch (err) {
            setError('Failed to archive service key');
            console.error('Error archiving service key:', err);
        }
    };

    const handleReactivateKey = async (keyId: number) => {
        try {
            setError(null);
            const accessToken = await getAccessToken();

            await reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut({
                path: {
                    api_key_id: keyId
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            fetchApiKeys();
        } catch (err) {
            setError('Failed to reactivate API key');
            console.error('Error reactivating API key:', err);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
        }
    };

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading || !user) {
        return (
            <div className="flex flex-col h-full select-none" style={{ backgroundColor: '#161715' }}>
                <header className="px-8 pt-6 pb-3 sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                    <h1 className="text-base font-semibold text-gray-900 dark:text-white">Developer Portal</h1>
                </header>
                <div className="max-w-5xl w-full mx-auto px-8 pt-6 space-y-4">
                    <Skeleton className="h-40 w-full rounded-2xl" style={{ backgroundColor: '#1C1E1A' }} />
                </div>
            </div>
        );
    }

    const activeServiceKeys = serviceKeys.filter(key => !key.archived_at);
    const canCreateServiceKey = !isOSS || activeServiceKeys.length === 0;
    const showServiceKeyArchiveControls = !isOSS;

    return (
        <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Page Header matching demo styling */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                            Developer Portal
                        </h1>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Manage your API keys to access Dograh services programmatically
                    </p>
                </div>
            </header>

            {/* Main Workspace Container */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs font-semibold">
                        {error}
                    </div>
                )}

                {/* CARD 1: API Keys */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                                API Keys
                            </h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Create and manage API keys for your organization
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowArchived(!showArchived)}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 border border-gray-200 dark:border-[#282b26] rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                                style={{ backgroundColor: '#161715' }}
                            >
                                {showArchived ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                )}
                                <span>{showArchived ? 'Hide' : 'Show'} Archived</span>
                            </button>

                            <button
                                onClick={() => setIsCreateDialogOpen(true)}
                                className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-semibold rounded-full shadow-xs transition-all cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                                <span>Create New Key</span>
                            </button>
                        </div>
                    </div>

                    {/* API Keys Item Box */}
                    <div className="space-y-3 pt-1">
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <Skeleton key={i} className="h-24 w-full rounded-2xl" style={{ backgroundColor: '#161715' }} />
                                ))}
                            </div>
                        ) : apiKeys.length === 0 ? (
                            <div className="text-center py-12">
                                <Key className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">No API keys found</p>
                                <button
                                    onClick={() => setIsCreateDialogOpen(true)}
                                    className="px-4 py-2 bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] text-xs font-semibold rounded-full cursor-pointer"
                                >
                                    Create Your First API Key
                                </button>
                            </div>
                        ) : (
                            apiKeys.map((key) => (
                                <div
                                    key={key.id}
                                    className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col gap-3 transition-all"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-xs font-bold text-gray-900 dark:text-white">
                                                {key.name}
                                            </h3>
                                            {key.archived_at ? (
                                                <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[10.5px] font-bold rounded-full">
                                                    Archived
                                                </span>
                                            ) : key.is_active ? (
                                                <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 text-[10.5px] font-bold rounded-full">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-500/10 text-rose-800 dark:text-rose-400 text-[10.5px] font-bold rounded-full">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {key.archived_at ? (
                                                <button
                                                    onClick={() => handleReactivateKey(key.id)}
                                                    className="p-1.5 rounded-lg border border-gray-200 dark:border-[#282b26] text-gray-600 dark:text-gray-300 hover:text-white text-xs flex items-center gap-1 cursor-pointer"
                                                >
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                    <span>Reactivate</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleArchiveKey(key.id)}
                                                    className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                                                    title="Delete Key"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Key Value & Hidden notice */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                        <div
                                            className="px-3.5 py-2 border border-gray-200/80 dark:border-[#282b26] rounded-xl font-mono text-xs text-gray-800 dark:text-gray-200 font-semibold w-fit"
                                            style={{ backgroundColor: '#1C1E1A' }}
                                        >
                                            {key.key_prefix}...
                                        </div>
                                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                            (Full key hidden for security)
                                        </span>
                                    </div>

                                    <p className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">
                                        Created: {formatDate(key.created_at)} • Last used: {formatDate(key.last_used_at ?? null)}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* CARD 2: Dograh Service Keys */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                                Dograh Service Keys
                            </h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Manage service keys for accessing Dograh AI services (LLM, TTS, STT)
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            {showServiceKeyArchiveControls && (
                                <button
                                    onClick={() => setShowServiceArchived(!showServiceArchived)}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-gray-200 dark:border-[#282b26] rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    {showServiceArchived ? (
                                        <EyeOff className="w-3.5 h-3.5" />
                                    ) : (
                                        <Eye className="w-3.5 h-3.5" />
                                    )}
                                    <span>{showServiceArchived ? 'Hide' : 'Show'} Archived</span>
                                </button>
                            )}
                            {canCreateServiceKey ? (
                                <button
                                    onClick={() => setIsCreateServiceDialogOpen(true)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-semibold rounded-full shadow-xs transition-all cursor-pointer"
                                >
                                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                                    <span>Create Service Key</span>
                                </button>
                            ) : (
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                    To generate additional service keys, <a href="https://app.dograh.com" target="_blank" rel="noopener noreferrer" className="text-amber-600 dark:text-amber-400 hover:underline font-semibold">Sign up on app.dograh.com</a>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Service Keys Item Box */}
                    <div className="space-y-3 pt-1">
                        {isServiceKeysLoading ? (
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <Skeleton key={i} className="h-24 w-full rounded-2xl" style={{ backgroundColor: '#161715' }} />
                                ))}
                            </div>
                        ) : serviceKeys.length === 0 ? (
                            <div className="text-center py-12">
                                <Key className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">No service keys found</p>
                                {canCreateServiceKey && (
                                    <button
                                        onClick={() => setIsCreateServiceDialogOpen(true)}
                                        className="px-4 py-2 bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] text-xs font-semibold rounded-full cursor-pointer"
                                    >
                                        Create Your First Service Key
                                    </button>
                                )}
                            </div>
                        ) : (
                            serviceKeys.map((key) => (
                                <div
                                    key={key.id}
                                    className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col gap-3 transition-all"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-xs font-bold text-gray-900 dark:text-white">
                                                {key.name}
                                            </h3>
                                            {key.archived_at ? (
                                                <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[10.5px] font-bold rounded-full">
                                                    Archived
                                                </span>
                                            ) : key.is_active ? (
                                                <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 text-[10.5px] font-bold rounded-full">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-500/10 text-rose-800 dark:text-rose-400 text-[10.5px] font-bold rounded-full">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>

                                        {!key.archived_at && showServiceKeyArchiveControls && (
                                            <button
                                                onClick={() => handleArchiveServiceKey(String(key.id))}
                                                className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                                                title="Delete Service Key"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Key Value & Hidden notice */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                        <div
                                            className="px-3.5 py-2 border border-gray-200/80 dark:border-[#282b26] rounded-xl font-mono text-xs text-gray-800 dark:text-gray-200 font-semibold w-fit"
                                            style={{ backgroundColor: '#1C1E1A' }}
                                        >
                                            {key.key_prefix}...
                                        </div>
                                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                            (Full key hidden for security)
                                        </span>
                                    </div>

                                    <p className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">
                                        Created: {formatDate(key.created_at)} • Last used: {formatDate(key.last_used_at ?? null)}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Security Warning Alert Banner matching demo */}
                <div
                    className="border border-amber-200/80 dark:border-amber-500/20 rounded-2xl p-4 flex items-start gap-3 text-amber-900 dark:text-amber-400 text-xs leading-relaxed shadow-2xs"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p>
                        <strong className="font-bold">Important:</strong> Keep your API keys secure. Never share them publicly or commit them to version control. API keys provide full access to your organization's resources.
                    </p>
                </div>
            </div>

            {/* Create API Key Dialog */}
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="border border-gray-200 dark:border-[#282b26] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 text-gray-900 dark:text-white" style={{ backgroundColor: '#1C1E1A' }}>
                    <DialogHeader className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                        <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">Create New API Key</DialogTitle>
                        <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
                            Give your new key a descriptive name to identify its usage.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1">
                        <div className="space-y-1.5">
                            <label htmlFor="name" className="text-xs font-bold text-gray-900 dark:text-white block">Key Name</label>
                            <input
                                id="name"
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="e.g. Production Webhook Server"
                                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-normal focus:outline-hidden"
                                style={{ backgroundColor: '#161715' }}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-[#282b26]">
                        <button
                            type="button"
                            onClick={() => setIsCreateDialogOpen(false)}
                            className="px-4 py-2 rounded-full text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#161715] cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateKey}
                            className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] cursor-pointer shadow-xs"
                        >
                            Generate Key
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Show Created Key Dialog */}
            <Dialog open={showCreatedKeyDialog} onOpenChange={setShowCreatedKeyDialog}>
                <DialogContent className="border border-gray-200 dark:border-[#282b26] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5 text-gray-900 dark:text-white" style={{ backgroundColor: '#1C1E1A' }}>
                    <DialogHeader className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                        <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">API Key Created Successfully</DialogTitle>
                        <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
                            Make sure to copy your API key now. You won't be able to see it again!
                        </DialogDescription>
                    </DialogHeader>
                    {createdKey && (
                        <div className="space-y-4 py-1">
                            <div className="p-4 border border-gray-200 dark:border-[#282b26] rounded-xl" style={{ backgroundColor: '#161715' }}>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-bold">Your API Key:</p>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 p-2 bg-white dark:bg-[#1C1E1A] border border-gray-200 dark:border-[#282b26] rounded text-xs font-mono break-all text-gray-900 dark:text-white">
                                        {createdKey.api_key}
                                    </code>
                                    <button
                                        onClick={() => copyToClipboard(createdKey.api_key)}
                                        className="p-2 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#161715] cursor-pointer shrink-0"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 border border-amber-200/80 dark:border-amber-500/20 rounded-xl" style={{ backgroundColor: '#161715' }}>
                                <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold leading-relaxed">
                                    Store this key securely. It will only be shown once and cannot be retrieved later.
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="flex gap-3 justify-end pt-3 border-t border-gray-100 dark:border-[#282b26]">
                        <button
                            onClick={() => {
                                setShowCreatedKeyDialog(false);
                                setCreatedKey(null);
                            }}
                            className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] cursor-pointer shadow-xs"
                        >
                            Done
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create Service Key Dialog */}
            <Dialog open={isCreateServiceDialogOpen} onOpenChange={setIsCreateServiceDialogOpen}>
                <DialogContent className="border border-gray-200 dark:border-[#282b26] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 text-gray-900 dark:text-white" style={{ backgroundColor: '#1C1E1A' }}>
                    <DialogHeader className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                        <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">Create New Service Key</DialogTitle>
                        <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
                            Create a service key to access Dograh AI services (LLM, TTS, STT)
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-1">
                        <div className="space-y-1.5">
                            <label htmlFor="service-name" className="text-xs font-bold text-gray-900 dark:text-white block">Service Key Name</label>
                            <input
                                id="service-name"
                                value={newServiceKeyName}
                                onChange={(e) => setNewServiceKeyName(e.target.value)}
                                placeholder="e.g. Production AI Services, Development LLM Access"
                                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-normal focus:outline-hidden"
                                style={{ backgroundColor: '#161715' }}
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-[#282b26]">
                        <button
                            type="button"
                            onClick={() => setIsCreateServiceDialogOpen(false)}
                            className="px-4 py-2 rounded-full text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#161715] cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateServiceKey}
                            className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] cursor-pointer shadow-xs"
                        >
                            Create Service Key
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Show Created Service Key Dialog */}
            <Dialog open={showCreatedServiceKeyDialog} onOpenChange={setShowCreatedServiceKeyDialog}>
                <DialogContent className="border border-gray-200 dark:border-[#282b26] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5 text-gray-900 dark:text-white" style={{ backgroundColor: '#1C1E1A' }}>
                    <DialogHeader className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                        <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">Service Key Created Successfully</DialogTitle>
                        <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
                            Make sure to copy your service key now. You won't be able to see it again!
                        </DialogDescription>
                    </DialogHeader>
                    {createdServiceKey && (
                        <div className="space-y-4 py-1">
                            <div className="p-4 border border-gray-200 dark:border-[#282b26] rounded-xl" style={{ backgroundColor: '#161715' }}>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-bold">Your Service Key:</p>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 p-2 bg-white dark:bg-[#1C1E1A] border border-gray-200 dark:border-[#282b26] rounded text-xs font-mono break-all text-gray-900 dark:text-white">
                                        {createdServiceKey.service_key}
                                    </code>
                                    <button
                                        onClick={() => copyToClipboard(createdServiceKey.service_key)}
                                        className="p-2 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#161715] cursor-pointer shrink-0"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 border border-amber-200/80 dark:border-amber-500/20 rounded-xl" style={{ backgroundColor: '#161715' }}>
                                <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold leading-relaxed">
                                    Store this key securely. It will only be shown once and cannot be retrieved later.
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="flex gap-3 justify-end pt-3 border-t border-gray-100 dark:border-[#282b26]">
                        <button
                            onClick={() => {
                                setShowCreatedServiceKeyDialog(false);
                                setCreatedServiceKey(null);
                            }}
                            className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] cursor-pointer shadow-xs"
                        >
                            Done
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
