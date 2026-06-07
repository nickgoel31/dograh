"use client";

import Link from 'next/link';

import { GitHubStarBadge } from '@/components/layout/GitHubStarBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { Bot, Settings2, BookOpen, Bug } from 'lucide-react';

export default function OverviewPage() {
    const { user, provider } = useAuth();
    const isOSSMode = provider !== 'stack';

    return (
        <div className="container mx-auto px-4 py-8 relative">
            <div className="max-w-4xl mx-auto">
                {/* Welcome Card */}
                <Card className="mb-8 glass-card border-primary/20 bg-card/60 backdrop-blur-md relative overflow-hidden fade-in-up">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />
                    <CardHeader>
                        <CardTitle className="text-3xl font-extrabold tracking-tight">
                            {isOSSMode ? (
                                <span className="text-gradient">Welcome</span>
                            ) : (
                                <>
                                    Welcome, <span className="text-gradient">{user?.displayName ? user.displayName.split(' ')[0] : 'User'}</span>!
                                </>
                            )}
                        </CardTitle>
                        <CardDescription className="text-lg mt-2 text-muted-foreground/90">
                            {isOSSMode ? (
                                <>
                                    Open source alternative to Vapi. Help us support the project by giving us a star on GitHub.
                                </>
                            ) : (
                                "Get started with building voice AI workflows"
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isOSSMode && (
                            <div className="mb-6">
                                <GitHubStarBadge label="Star us on GitHub" showCount source="overview_page" />
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 stagger-children">
                    <Card className="glass-card hover-glow bg-card/60 backdrop-blur-md">
                        <CardHeader>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="icon-container">
                                    <Bot className="h-5 w-5" />
                                </div>
                                <CardTitle className="text-xl font-bold">Manage Voice Agents</CardTitle>
                            </div>
                            <CardDescription className="text-muted-foreground/80 mt-1">
                                Build powerful AI Voice Agents with our visual editor
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild className="hover-glow bg-primary hover:bg-primary/90 text-primary-foreground">
                                <Link href="/workflow">
                                    Go to Agents
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="glass-card hover-glow bg-card/60 backdrop-blur-md">
                        <CardHeader>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="icon-container">
                                    <Settings2 className="h-5 w-5" />
                                </div>
                                <CardTitle className="text-xl font-bold">Configure Services</CardTitle>
                            </div>
                            <CardDescription className="text-muted-foreground/80 mt-1">
                                Set up your AI services like LLM, TTS, and STT providers
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button asChild variant="outline" className="border-primary/20 hover:bg-primary/5 hover:text-primary">
                                <Link href="/model-configurations">
                                    Configure Models
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Resources Section */}
                <Card className="mt-8 glass-card bg-card/60 backdrop-blur-md fade-in-up" style={{ animationDelay: '0.4s' }}>
                    <CardHeader>
                        <CardTitle className="text-xl font-bold">Resources</CardTitle>
                        <CardDescription className="text-muted-foreground/80 mt-1">
                            Get help and learn more about our platform
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-4">
                            <Button asChild variant="outline" className="border-primary/20 hover:bg-primary/5 hover:text-primary transition-all duration-300">
                                <a
                                    href="https://docs.dograh.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <BookOpen className="h-4 w-4 mr-2" />
                                    Documentation
                                </a>
                            </Button>
                            <Button asChild variant="outline" className="border-primary/20 hover:bg-primary/5 hover:text-primary transition-all duration-300">
                                <a
                                    href="https://github.com/dograh-hq/dograh/issues"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Bug className="h-4 w-4 mr-2" />
                                    Report an Issue
                                </a>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
