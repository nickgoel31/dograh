"use client";

import { Copy, Eye, EyeOff, Key, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
import type { ApiKeyResponse, CreateApiKeyResponse, CreateServiceKeyResponse,ServiceKeyResponse } from '@/client/types.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchApiKeys = useCallback(async () => {
        logger.debug('[APIKeysPage] fetchApiKeys called', {
            loading,
            hasUser: !!user,
            userId: user?.id
        });

        // Follow the pattern from UserConfigContext - check both loading and user
        if (loading || !user) {
            logger.debug('[APIKeysPage] fetchApiKeys - skipping due to loading or no user');
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            logger.debug('[APIKeysPage] fetchApiKeys - calling getAccessToken...');
            const accessToken = await getAccessToken();
            logger.debug('[APIKeysPage] fetchApiKeys - got access token');

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
        logger.debug('[APIKeysPage] fetchServiceKeys called', {
            loading,
            hasUser: !!user,
            userId: user?.id
        });

        // Follow the pattern from UserConfigContext - check both loading and user
        if (loading || !user) {
            logger.debug('[APIKeysPage] fetchServiceKeys - skipping due to loading or no user');
            return;
        }

        try {
            setIsServiceKeysLoading(true);
            setError(null);
            logger.debug('[APIKeysPage] fetchServiceKeys - calling getAccessToken...');
            const accessToken = await getAccessToken();
            logger.debug('[APIKeysPage] fetchServiceKeys - got access token');

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
        logger.debug('[APIKeysPage] useEffect for fetchApiKeys triggered');
        fetchApiKeys();
    }, [fetchApiKeys]);

    useEffect(() => {
        logger.debug('[APIKeysPage] useEffect for fetchServiceKeys triggered');
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

    // Don't render content until auth is loaded
    if (loading || !user) {
        return (
            <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-96" />
                </div>
            </div>
        );
    }

    // In OSS mode, check if there's already an active service key
    const activeServiceKeys = serviceKeys.filter(key => !key.archived_at);
    const canCreateServiceKey = !isOSS || activeServiceKeys.length === 0;
    const showServiceKeyArchiveControls = !isOSS;

    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                    <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                        Developer Portal
                    </h1>
                    <p className="text-xs text-zinc-500 mt-1">Manage your API keys to access Dograh services programmatically</p>
                </div>

                {error && (
                    <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
                        {error}
                    </div>
                )}

                <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none mb-6">
                    <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle className="text-lg font-bold text-white">API Keys</CardTitle>
                                <CardDescription className="text-xs text-zinc-500">
                                    Create and manage API keys for your organization
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => setShowArchived(!showArchived)}
                                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3.5 py-2.5 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer"
                                >
                                    {showArchived ? <Eye className="w-4 h-4 mr-2 inline" /> : <EyeOff className="w-4 h-4 mr-2 inline" />}
                                    {showArchived ? 'Hide' : 'Show'} Archived
                                </Button>
                                <Button
                                    onClick={() => setIsCreateDialogOpen(true)}
                                    className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer"
                                >
                                    <Plus className="w-4 h-4 mr-2 inline" />
                                    Create New Key
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="space-y-4">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl bg-[#111113] shimmer">
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-32 bg-zinc-800" />
                                            <Skeleton className="h-3 w-24 bg-zinc-800" />
                                        </div>
                                        <Skeleton className="h-8 w-20 bg-zinc-800" />
                                    </div>
                                ))}
                            </div>
                        ) : apiKeys.length === 0 ? (
                            <div className="text-center py-12">
                                <Key className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                                <p className="text-xs text-zinc-400 mb-4">No API keys found</p>
                                <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                                    Create Your First API Key
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {apiKeys.map((key) => (
                                    <div
                                        key={key.id}
                                        className={`flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl ${
                                            key.archived_at ? 'bg-[#08080a]/60 opacity-60' : 'bg-[#08080a]'
                                        }`}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="font-semibold text-zinc-200 text-sm">{key.name}</span>
                                                {key.archived_at ? (
                                                    <Badge className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Archived</Badge>
                                                ) : key.is_active ? (
                                                    <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Active</Badge>
                                                ) : (
                                                    <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Inactive</Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                <span className="font-mono bg-[#1c1c1f] border border-[#232328] px-2 py-0.5 rounded text-zinc-300">{key.key_prefix}...</span>
                                                <span className="text-[10px] text-zinc-600">
                                                    (Full key hidden for security)
                                                </span>
                                            </div>
                                            <div className="mt-2 text-[10px] text-zinc-500">
                                                Created: {formatDate(key.created_at)} •
                                                Last used: {formatDate(key.last_used_at ?? null)}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {key.archived_at ? (
                                                <Button
                                                    onClick={() => handleReactivateKey(key.id)}
                                                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
                                                >
                                                    <RefreshCw className="w-4 h-4 mr-1 inline" />
                                                    Reactivate
                                                </Button>
                                            ) : (
                                                <Button
                                                    onClick={() => handleArchiveKey(key.id)}
                                                    className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors bg-transparent cursor-pointer"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Dograh Service Keys Section */}
                <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none mb-6">
                    <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle className="text-lg font-bold text-white">Dograh Service Keys</CardTitle>
                                <CardDescription className="text-xs text-zinc-500">
                                    Manage service keys for accessing Dograh AI services (LLM, TTS, STT)
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                {showServiceKeyArchiveControls && (
                                    <Button
                                        onClick={() => setShowServiceArchived(!showServiceArchived)}
                                        className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3.5 py-2.5 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer"
                                    >
                                        {showServiceArchived ? <Eye className="w-4 h-4 mr-2 inline" /> : <EyeOff className="w-4 h-4 mr-2 inline" />}
                                        {showServiceArchived ? 'Hide' : 'Show'} Archived
                                    </Button>
                                )}
                                {canCreateServiceKey ? (
                                    <Button
                                        onClick={() => setIsCreateServiceDialogOpen(true)}
                                        className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer"
                                    >
                                        <Plus className="w-4 h-4 mr-2 inline" />
                                        Create Service Key
                                    </Button>
                                ) : (
                                    <span className="text-xs text-zinc-400">
                                        To generate additional service keys, <a href="https://app.dograh.com" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">Sign up on app.dograh.com</a>
                                    </span>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isServiceKeysLoading ? (
                            <div className="space-y-4">
                                {[1, 2].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl bg-[#111113] shimmer">
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-32 bg-zinc-800" />
                                            <Skeleton className="h-3 w-24 bg-zinc-800" />
                                        </div>
                                        <Skeleton className="h-8 w-20 bg-zinc-800" />
                                    </div>
                                ))}
                            </div>
                        ) : serviceKeys.length === 0 ? (
                            <div className="text-center py-12">
                                <Key className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                                <p className="text-xs text-zinc-400 mb-4">No service keys found</p>
                                {canCreateServiceKey && (
                                    <Button onClick={() => setIsCreateServiceDialogOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                                        Create Your First Service Key
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {serviceKeys.map((key) => (
                                    <div
                                        key={key.id}
                                        className={`flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl ${
                                            key.archived_at ? 'bg-[#08080a]/60 opacity-60' : 'bg-[#08080a]'
                                        }`}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="font-semibold text-zinc-200 text-sm">{key.name}</span>
                                                {key.archived_at ? (
                                                    <Badge className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Archived</Badge>
                                                ) : key.is_active ? (
                                                    <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Active</Badge>
                                                ) : (
                                                    <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Inactive</Badge>
                                                )}
                                                {key.expires_at && new Date(key.expires_at) > new Date() && (
                                                    <Badge className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                                                        Expires: {formatDate(key.expires_at)}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                                <span className="font-mono bg-[#1c1c1f] border border-[#232328] px-2 py-0.5 rounded text-zinc-300">{key.key_prefix}...</span>
                                                <span className="text-[10px] text-zinc-600">
                                                    (Full key hidden for security)
                                                </span>
                                            </div>
                                            <div className="mt-2 text-[10px] text-zinc-500">
                                                Created: {formatDate(key.created_at)} •
                                                Last used: {formatDate(key.last_used_at ?? null)}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {!key.archived_at && showServiceKeyArchiveControls && (
                                                <Button
                                                    onClick={() => handleArchiveServiceKey(String(key.id))}
                                                    className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors bg-transparent cursor-pointer"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <p className="text-xs text-amber-400 font-semibold leading-relaxed">
                        <strong>Important:</strong> Keep your API keys secure. Never share them publicly or commit them to version control.
                        API keys provide full access to your organization&apos;s resources.
                    </p>
                </div>
            </div>

        {/* Create API Key Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-lg font-bold text-white">Create New API Key</DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                        Enter a descriptive name for your API key to help you identify it later.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid gap-1">
                        <Label htmlFor="name" className="text-xs font-bold text-zinc-300 block mb-1.5">Key Name</Label>
                        <Input
                            id="name"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            placeholder="e.g., Production Server, Development Environment"
                            className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                        />
                    </div>
                </div>
                <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
                    <Button
                        className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
                        onClick={() => setIsCreateDialogOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleCreateKey} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                        Create Key
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Show Created Key Dialog */}
        <Dialog open={showCreatedKeyDialog} onOpenChange={setShowCreatedKeyDialog}>
            <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-lg font-bold text-white">API Key Created Successfully</DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                        Make sure to copy your API key now. You won&apos;t be able to see it again!
                    </DialogDescription>
                </DialogHeader>
                {createdKey && (
                    <div className="space-y-4">
                        <div className="p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl">
                            <p className="text-xs text-zinc-400 mb-2 font-bold">Your API Key:</p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 p-2 bg-[#1c1c1f] border border-[#232328] rounded text-xs font-mono break-all text-zinc-300">
                                    {createdKey.api_key}
                                </code>
                                <Button
                                    onClick={() => copyToClipboard(createdKey.api_key)}
                                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer shrink-0"
                                >
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <p className="text-xs text-amber-400 font-semibold leading-relaxed">
                                Store this key securely. It will only be shown once and cannot be retrieved later.
                            </p>
                        </div>
                    </div>
                )}
                <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
                    <Button onClick={() => {
                        setShowCreatedKeyDialog(false);
                        setCreatedKey(null);
                    }} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Create Service Key Dialog */}
        <Dialog open={isCreateServiceDialogOpen} onOpenChange={setIsCreateServiceDialogOpen}>
            <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-lg font-bold text-white">Create New Service Key</DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                        Create a service key to access Dograh AI services (LLM, TTS, STT)
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid gap-1">
                        <Label htmlFor="service-name" className="text-xs font-bold text-zinc-300 block mb-1.5">Service Key Name</Label>
                        <Input
                            id="service-name"
                            value={newServiceKeyName}
                            onChange={(e) => setNewServiceKeyName(e.target.value)}
                            placeholder="e.g., Production AI Services, Development LLM Access"
                            className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                        />
                    </div>
                </div>
                <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
                    <Button
                        className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
                        onClick={() => setIsCreateServiceDialogOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleCreateServiceKey} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                        Create Service Key
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Show Created Service Key Dialog */}
        <Dialog open={showCreatedServiceKeyDialog} onOpenChange={setShowCreatedServiceKeyDialog}>
            <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-lg font-bold text-white">Service Key Created Successfully</DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                        Make sure to copy your service key now. You won&apos;t be able to see it again!
                    </DialogDescription>
                </DialogHeader>
                {createdServiceKey && (
                    <div className="space-y-4">
                        <div className="p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl">
                            <p className="text-xs text-zinc-400 mb-2 font-bold">Your Service Key:</p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 p-2 bg-[#1c1c1f] border border-[#232328] rounded text-xs font-mono break-all text-zinc-300">
                                    {createdServiceKey.service_key}
                                </code>
                                <Button
                                    onClick={() => copyToClipboard(createdServiceKey.service_key)}
                                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer shrink-0"
                                >
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl">
                            <p className="text-xs text-blue-400 font-semibold leading-relaxed">
                                This key provides access to Dograh AI services including LLM, Text-to-Speech, and Speech-to-Text.
                                {createdServiceKey.expires_at && (
                                    <span className="block mt-1">
                                        Expires on: {formatDate(createdServiceKey.expires_at)}
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <p className="text-xs text-amber-400 font-semibold leading-relaxed">
                                Store this key securely. It will only be shown once and cannot be retrieved later.
                            </p>
                        </div>
                    </div>
                )}
                <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
                    <Button onClick={() => {
                        setShowCreatedServiceKeyDialog(false);
                        setCreatedServiceKey(null);
                    }} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
    );
}
