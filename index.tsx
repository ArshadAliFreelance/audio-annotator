
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import * as docx from 'docx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

declare module 'jspdf' {
    interface jsPDF {
        autoTable: (options: any) => jsPDF;
    }
}

interface Annotation {
    startTime: string;
    endTime: string;
    transcript: string;
    speaker?: string;
    sentimentTags?: string[];
    soundTags?: string[];
}

type Template = 'General' | 'Legal' | 'Medical' | 'Academic' | 'Accessibility';
type Mode = 'audio' | null;

const USER_MANUAL_CONTENT = `# Audio Annotator User Manual

Welcome to the Audio Annotator! This application is designed to help you efficiently transcribe and analyze audio files using AI.

This manual will guide you through all the features, from uploading your first file to exporting your final annotations.

---

## 1. The Interface

The application is divided into two main panels:
- **The Media Panel (Left):** This is where you upload your audio file. Once loaded, it will display your audio player.
- **The Annotations Panel (Right):** This is your main workspace. It's where the AI-generated annotations appear and where you can edit them and export your final work.

---

## 2. Getting Started

### 2.1. Uploading an Audio File
- **Drag & Drop:** Drag your audio file and drop it into the upload area on the left.
- **File Selector:** Click the upload area to open your file browser and select an audio file.

### 2.2. Choosing an Annotation Template
Before you upload an audio file, select a template that best fits your content. This choice will influence how the AI processes the audio for the most accurate results.
- **General Use:** For everyday conversations, interviews, or general audio.
- **Legal Proceedings:** Optimized for court hearings, depositions, or legal interviews.
- **Medical Dictation:** Tuned for doctor-patient consultations or medical lectures.
- **Academic / Research:** For research interviews or academic lectures.
- **Accessibility (WCAG):** For creating accessible content with detailed descriptions of non-speech sounds for users with disabilities.

---

## 3. Audio Annotation
When you upload an audio file, the AI generates a time-stamped breakdown of the content. You can find these annotations in the right-hand panel.
- **What's Generated:** Segments include start/end times, transcripts, speaker labels, sentiment tags (e.g., *happy*, *urgent*), and sound event tags (e.g., *music*, *applause*).
- **Editing:** You can click on any annotation to edit its content, add or remove tags, or adjust timestamps. Use the **+ Add** button to manually create a new annotation at the player's current time.

---

## 4. Workspace Tools

### 4.1. History Control (Undo & Redo)
- **Undo:** Reverts your last action (e.g., editing text, adding a tag).
- **Redo:** Re-applies an action you undid.

### 4.2. Exporting Your Work
Click the **Download** button to see a list of available export formats.
- **Available Formats:** JSON, Text (.txt), Markdown (.md), Word (.docx), PDF, CSV, XML, SRT (subtitles), and VTT (web captions).

### 4.3. Clearing the Workspace
- The **Clear** button removes the current file and all its annotations, allowing you to start fresh.

---

## 5. Privacy and Data Collection Disclaimer
- **Data Processing:** Audio files you provide are sent to the Google Gemini API for processing.
- **Data Storage:** We do not store your files on our servers after the analysis.
- **Sensitive Information:** We strongly advise against uploading any files containing sensitive personal, financial, or confidential information.
- **Acknowledgement:** By using this application, you acknowledge and agree to this data processing arrangement.

Thank you for using the Audio Annotator!
`;

const App = () => {
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [mediaUrl, setMediaUrl] = useState('');
    const [mode, setMode] = useState<Mode>(null);
    const [template, setTemplate] = useState<Template>('General');
    
    const [history, setHistory] = useState<Annotation[][]>([[]]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const annotations = history[historyIndex] || [];
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isDownloadDropdownOpen, setIsDownloadDropdownOpen] = useState(false);
    const [isManualOpen, setIsManualOpen] = useState(false);

    const mediaRef = useRef<HTMLAudioElement>(null);
    const downloadDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (downloadDropdownRef.current && !downloadDropdownRef.current.contains(event.target as Node)) {
                setIsDownloadDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const setAnnotationsWithHistory = (newAnnotations: Annotation[]) => {
        const newHistory = history.slice(0, historyIndex + 1);
        setHistory([...newHistory, newAnnotations]);
        setHistoryIndex(newHistory.length);
    };

    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result.split(',')[1]);
            } else {
                reject(new Error('Failed to read file as base64 string.'));
            }
        };
        reader.onerror = error => reject(error);
    });
    
    const handleFileDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) {
            handleFile(file);
        }
    }, []);
    
    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            handleFile(file);
        }
    }, []);
    
    const resetState = () => {
        setMediaFile(null);
        setMediaUrl('');
        setHistory([[]]);
        setHistoryIndex(0);
        setError('');
    }

    const handleFile = async (file: File) => {
        resetState();
        setMediaFile(file);
        
        if (file.type.startsWith('audio/')) {
            setMode('audio');
            setMediaUrl(URL.createObjectURL(file));
            await generateAnnotations(file);
        } else {
            setMode(null);
            setError('Please upload a valid audio file.');
        }
    }

    const generateAnnotations = async (fileToAnnotate: File) => {
        if (!fileToAnnotate) {
            setError('No file provided for annotation.');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const base64Data = await fileToBase64(fileToAnnotate);

            const mediaPart = {
                inlineData: {
                    mimeType: fileToAnnotate.type,
                    data: base64Data,
                },
            };
            
            let prompt: string;
            switch (template) {
                case 'Legal':
                    prompt = `Analyze this legal proceeding audio with a focus on legal-specific details. Provide a detailed, time-stamped (in HH:MM:SS.mmm format) breakdown. For each segment, provide the following:
                    1. A precise transcript.
                    2. Speaker diarization, attempting to identify roles like 'Judge', 'Plaintiff', 'Defense', 'Witness' where possible.
                    3. Sentiment/Emotion Tags: Tag for tones like 'argumentative', 'calm', 'distressed'.
                    4. Sound Event Tags: Specifically tag legal terms or actions like 'objection', 'sustained', 'overruled', 'gavel sound'.`;
                    break;
                case 'Medical':
                    prompt = `Analyze this medical recording (e.g., dictation, consultation) with high accuracy for medical contexts. Provide a detailed, time-stamped (in HH:MM:SS.mmm format) breakdown. For each segment, provide:
                    1. A highly accurate transcript, paying close attention to medical terminology.
                    2. Speaker diarization, identifying speakers like 'Doctor', 'Patient', 'Nurse'.
                    3. Sentiment/Emotion Tags: Tag for patient sentiment (e.g., 'anxious', 'pain', 'relieved').
                    4. Sound Event Tags: Tag for clinical sounds (e.g., 'coughing', 'breathing sounds', 'medical device beep').`;
                    break;
                case 'Academic':
                    prompt = `Analyze this academic audio content (lecture, research presentation) for educational purposes. Provide a detailed, time-stamped (in HH:MM:SS.mmm format) breakdown. For each segment, provide:
                    1. A clear transcript of the speaker's content.
                    2. Speaker diarization, differentiating between the 'Presenter' and 'Audience' (for questions).
                    3. Sentiment/Emotion Tags: This is less critical, can be omitted unless obvious.
                    4. Sound Event Tags: Tag key academic events like 'question asked', 'applause'. Also tag key concepts or terms mentioned.`;
                    break;
                case 'Accessibility':
                    prompt = `Analyze this audio file with a primary focus on accessibility (WCAG). Create a comprehensive and descriptive breakdown (using HH:MM:SS.mmm timestamps). For each segment, provide:
                    1. A verbatim transcript of all speech.
                    2. Speaker diarization to clarify who is speaking.
                    3. Sentiment/Emotion Tags: Tag emotions to provide context for users who cannot infer it from tone.
                    4. Sound Event Tags: Meticulously tag ALL non-speech sounds that are relevant to understanding the context (e.g., 'door opens', 'soft background music', 'phone ringing', 'footsteps approaching'). Be descriptive.`;
                    break;
                case 'General':
                default:
                    prompt = `Analyze this audio file and provide a detailed, time-stamped breakdown (using HH:MM:SS.mmm format). For each segment, provide the following:
                    1. A precise transcript of any spoken words.
                    2. Speaker diarization (label speakers as 'Speaker 1', 'Speaker 2', etc.).
                    3. Sentiment/Emotion Tags: A list of tags for tone, mood, or intent (e.g., 'happy', 'urgent', 'positive').
                    4. Sound Event Tags: A list of tags for background noises, music, or other sound classifications (e.g., 'music', 'applause', 'silence').`;
            }

            const textPart = { text: prompt };

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [mediaPart, textPart] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                startTime: { type: Type.STRING, description: "Start time of the segment in HH:MM:SS.mmm format." },
                                endTime: { type: Type.STRING, description: "End time of the segment in HH:MM:SS.mmm format." },
                                transcript: { type: Type.STRING, description: "The transcript for this segment." },
                                speaker: { type: Type.STRING, description: "The identified speaker for this segment (e.g., 'Speaker 1')." },
                                sentimentTags: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING },
                                    description: "Tags for emotion (e.g., 'happy') or sentiment ('positive')."
                                },
                                soundTags: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING },
                                    description: "Tags for sound classification ('music', 'applause', 'silence')."
                                }
                            },
                            required: ["startTime", "endTime", "transcript"]
                        }
                    }
                }
            });
            
            const parsedAnnotations = JSON.parse(response.text).map((ann: any) => ({
                ...ann,
                sentimentTags: ann.sentimentTags || [],
                soundTags: ann.soundTags || [],
                speaker: ann.speaker || '',
            }));
            setAnnotationsWithHistory(parsedAnnotations);

        } catch (err) {
            console.error(err);
            let friendlyError = 'Failed to generate annotations. Please check the console for details.';
            if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
                const errorMessage = err.message.toLowerCase();
                if (errorMessage.includes('unauthenticated') || errorMessage.includes('401') || errorMessage.includes('api key not valid')) {
                    friendlyError = 'Authentication Error: The API key is invalid or missing. Please ensure it is correctly configured in your environment settings.';
                } else if (errorMessage.includes('quota')) {
                    friendlyError = 'Quota Exceeded: You have exceeded your API usage limit. Please check your Google AI Platform console.';
                }
            }
            setError(friendlyError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAnnotationChange = (index: number, field: keyof Omit<Annotation, 'sentimentTags' | 'soundTags'>, value: string) => {
        const newAnnotations = [...(annotations as Annotation[])];
        newAnnotations[index] = { ...newAnnotations[index], [field]: value };
        setAnnotationsWithHistory(newAnnotations);
    };
    
    type TagType = 'sentimentTags' | 'soundTags';

    const addTag = (annotationIndex: number, newTag: string, tagType: TagType) => {
        if (newTag.trim() === '') return;
        const newAnnotations = [...annotations];
        const annotation = { ...newAnnotations[annotationIndex] };
        const currentTags = annotation[tagType] || [];
        if (!currentTags.includes(newTag.trim())) {
            annotation[tagType] = [...currentTags, newTag.trim()];
            newAnnotations[annotationIndex] = annotation;
            setAnnotationsWithHistory(newAnnotations);
        }
    };

    const removeTag = (annotationIndex: number, tagToRemove: string, tagType: TagType) => {
        const newAnnotations = [...annotations];
        const annotation = { ...newAnnotations[annotationIndex] };
        annotation[tagType] = (annotation[tagType] || []).filter(tag => tag !== tagToRemove);
        newAnnotations[annotationIndex] = annotation;
        setAnnotationsWithHistory(newAnnotations);
    };

    const deleteAnnotation = (index: number) => {
        const newAnnotations = annotations.filter((_, i) => i !== index);
        setAnnotationsWithHistory(newAnnotations);
    };
    
    const formatTime = (totalSeconds: number): string => {
        if (isNaN(totalSeconds) || totalSeconds < 0) {
            totalSeconds = 0;
        }
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const milliseconds = Math.floor((totalSeconds * 1000) % 1000);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    };

    const addAnnotation = () => {
        const currentTime = mediaRef.current?.currentTime || 0;
        const formattedTime = formatTime(currentTime);

        const newAnnotation: Annotation = {
            startTime: formattedTime,
            endTime: formattedTime,
            transcript: '',
            speaker: '',
            sentimentTags: [],
            soundTags: [],
        };

        setAnnotationsWithHistory([newAnnotation, ...annotations]);
    };
    
    const timeToSeconds = (timeStr: string): number => {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        
        const [hms, msStr = '0'] = timeStr.split('.');
        const milliseconds = parseInt(msStr.padEnd(3, '0'), 10) / 1000;

        const parts = hms.split(':').map(part => parseInt(part, 10)).filter(num => !isNaN(num));
        
        let seconds = 0;
        if (parts.length === 3) {
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            seconds = parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
            seconds = parts[0];
        }
        
        if (isNaN(seconds) || isNaN(milliseconds)) {
            return 0;
        }

        return seconds + milliseconds;
    };

    const getBaseFilename = () => {
        if (mediaFile) return mediaFile.name.split('.').slice(0, -1).join('.')
        return 'annotations';
    }

    const downloadFile = (data: string, filename: string, type: string) => {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsDownloadDropdownOpen(false);
    };

    const escapeCsvCell = (cell: any) => {
        const str = String(cell);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const escapeXml = (str: string | number) => String(str).replace(/[<>&'"]/g, (c) => {
        switch(c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });

    const downloadJson = () => {
        let dataToExport = annotations.map(item => {
            const [startTime, endTime] = (timeToSeconds(item.startTime) > timeToSeconds(item.endTime))
                ? [item.endTime, item.startTime] : [item.startTime, item.endTime];
            const exportItem: any = { startTime, endTime, transcript: item.transcript, speaker: item.speaker, sentimentTags: item.sentimentTags, soundTags: item.soundTags };
            return exportItem;
        });
        const dataStr = JSON.stringify(dataToExport, null, 2);
        downloadFile(dataStr, `${getBaseFilename()}_annotations.json`, 'application/json');
    };

    const downloadTxt = () => {
        let textContent = '';
        annotations.forEach(item => {
            const [start, end] = (timeToSeconds(item.startTime) > timeToSeconds(item.endTime))
                ? [item.endTime, item.startTime]
                : [item.startTime, item.endTime];

            textContent += `[${start} - ${end}] ${item.speaker || 'Unknown Speaker'}:\n`;
            textContent += `${item.transcript}\n\n---\n\n`;
        });
        downloadFile(textContent, `${getBaseFilename()}.txt`, 'text/plain');
    };

    const downloadMd = () => {
        let mdContent = '';
        annotations.forEach(item => {
            const [start, end] = (timeToSeconds(item.startTime) > timeToSeconds(item.endTime))
                ? [item.endTime, item.startTime]
                : [item.startTime, item.endTime];

            mdContent += `**[${start} - ${end}] ${item.speaker || 'Unknown Speaker'}:**\n\n`;
            mdContent += `> ${item.transcript}\n\n`;
            mdContent += '---\n\n';
        });
        downloadFile(mdContent, `${getBaseFilename()}.md`, 'text/markdown');
    };

    const downloadDocx = async () => {
        if (!mediaFile) return;

        const paragraphs: docx.Paragraph[] = [];
        annotations.forEach(item => {
            const [start, end] = (timeToSeconds(item.startTime) > timeToSeconds(item.endTime))
                ? [item.endTime, item.startTime]
                : [item.startTime, item.endTime];
            
            paragraphs.push(
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: `[${start} - ${end}]`, bold: true }),
                        new docx.TextRun({ text: item.speaker ? ` ${item.speaker}:` : ':', bold: true }),
                    ],
                })
            );
            paragraphs.push(
                new docx.Paragraph({
                    children: [new docx.TextRun(item.transcript)],
                    style: "wellSpaced",
                })
            );
            paragraphs.push(new docx.Paragraph({ text: "" }));
        });

        const doc = new docx.Document({
            sections: [{ children: paragraphs }],
            styles: {
                paragraphStyles: [{
                    id: "wellSpaced",
                    name: "Well Spaced",
                    basedOn: "Normal",
                    next: "Normal",
                    paragraph: { spacing: { after: 200 } },
                }],
            },
        });

        const blob = await docx.Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${getBaseFilename()}.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsDownloadDropdownOpen(false);
    };

    const downloadCsv = () => {
        const headers = ['startTime', 'endTime', 'speaker', 'transcript', 'sentimentTags', 'soundTags'];
        
        let csvContent = headers.join(',') + '\n';
        
        annotations.forEach(ann => {
            const row = [
                ann.startTime,
                ann.endTime,
                ann.speaker || '',
                ann.transcript,
                (ann.sentimentTags || []).join(';'),
                (ann.soundTags || []).join(';')
            ];
            csvContent += row.map(escapeCsvCell).join(',') + '\n';
        });

        downloadFile(csvContent, `${getBaseFilename()}_annotations.csv`, 'text/csv');
    };

    const downloadXml = () => {
        let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<annotations>\n';

        annotations.forEach(ann => {
            xmlContent += '  <annotation>\n';
            xmlContent += `    <startTime>${escapeXml(ann.startTime)}</startTime>\n`;
            xmlContent += `    <endTime>${escapeXml(ann.endTime)}</endTime>\n`;
            xmlContent += `    <speaker>${escapeXml(ann.speaker || '')}</speaker>\n`;
            xmlContent += `    <transcript>${escapeXml(ann.transcript)}</transcript>\n`;
            xmlContent += '    <sentimentTags>\n';
            (ann.sentimentTags || []).forEach(tag => {
                xmlContent += `      <tag>${escapeXml(tag)}</tag>\n`;
            });
            xmlContent += '    </sentimentTags>\n';
            xmlContent += '    <soundTags>\n';
            (ann.soundTags || []).forEach(tag => {
                xmlContent += `      <tag>${escapeXml(tag)}</tag>\n`;
            });
            xmlContent += '    </soundTags>\n';
            xmlContent += '  </annotation>\n';
        });

        xmlContent += '</annotations>';
        downloadFile(xmlContent, `${getBaseFilename()}_annotations.xml`, 'application/xml');
    };
    
    const downloadSrt = () => {
        const formatSrtTime = (timeStr: string) => timeStr.replace('.', ',');
        let srtContent = '';
        annotations.forEach((ann, index) => {
            if (!ann.transcript.trim()) return;
            srtContent += `${index + 1}\n`;
            srtContent += `${formatSrtTime(ann.startTime)} --> ${formatSrtTime(ann.endTime)}\n`;
            srtContent += `${ann.transcript}\n\n`;
        });
        downloadFile(srtContent, `${getBaseFilename()}.srt`, 'application/x-subrip');
    };

    const downloadVtt = () => {
        let vttContent = 'WEBVTT\n\n';
        annotations.forEach(ann => {
            if (!ann.transcript.trim()) return;
            vttContent += `${ann.startTime} --> ${ann.endTime}\n`;
            vttContent += `${ann.transcript}\n\n`;
        });
        downloadFile(vttContent, `${getBaseFilename()}.vtt`, 'text/vtt');
    };

    const downloadPdf = () => {
        const doc = new jsPDF();
        
        doc.text(`Annotations for ${getBaseFilename()}`, 14, 16);
        
        const headers = [['Start Time', 'End Time', 'Speaker', 'Transcript']];

        const body = annotations.map(ann => {
            const row = [
                ann.startTime,
                ann.endTime,
                ann.speaker || 'N/A',
                ann.transcript,
            ];
            return row;
        });

        doc.autoTable({
            head: headers,
            body: body,
            startY: 20,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [3, 218, 198] }, // primary-color
            columnStyles: { 3: { cellWidth: 'auto' } } // Transcript column
        });

        doc.save(`${getBaseFilename()}_annotations.pdf`);
        setIsDownloadDropdownOpen(false);
    };


    const handleClear = () => {
        resetState();
        setMode(null);
        setTemplate('General');
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
        }
    };
    
    const FormattedManual = ({ content }: { content: string }) => {
        const lines = content.split('\n');
        const elements: JSX.Element[] = [];
        let listItems: string[] = [];

        const processLine = (line: string) => {
            let processedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            processedLine = processedLine.replace(/`(.*?)`/g, '<code>$1</code>');
            return processedLine;
        };
    
        const flushList = () => {
            if (listItems.length > 0) {
                elements.push(
                    <ul key={`ul-${elements.length}`}>
                        {listItems.map((item, index) => (
                            <li key={index} dangerouslySetInnerHTML={{ __html: processLine(item) }}></li>
                        ))}
                    </ul>
                );
                listItems = [];
            }
        };
    
        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('# ')) { flushList(); elements.push(<h1 key={index} dangerouslySetInnerHTML={{ __html: processLine(trimmedLine.substring(2)) }} />); }
            else if (trimmedLine.startsWith('## ')) { flushList(); elements.push(<h2 key={index} dangerouslySetInnerHTML={{ __html: processLine(trimmedLine.substring(3)) }} />); }
            else if (trimmedLine.startsWith('### ')) { flushList(); elements.push(<h3 key={index} dangerouslySetInnerHTML={{ __html: processLine(trimmedLine.substring(4)) }} />); }
            else if (trimmedLine === '---') { flushList(); elements.push(<hr key={index} />); }
            else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) { listItems.push(trimmedLine.substring(2).trim()); }
            else if (trimmedLine !== '') { flushList(); elements.push(<p key={index} dangerouslySetInnerHTML={{ __html: processLine(trimmedLine) }}></p>); }
            else { flushList(); }
        });
        flushList();
        return <>{elements}</>;
    };

    const ManualModal = () => (
        <div className="modal-overlay" onClick={() => setIsManualOpen(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>User Manual</h2>
                    <button className="modal-close-btn" onClick={() => setIsManualOpen(false)} aria-label="Close user manual">{'×'}</button>
                </div>
                <div className="modal-body">
                    <FormattedManual content={USER_MANUAL_CONTENT} />
                </div>
                <div className="modal-footer">
                    <p>© 2025 Arshad Ali | All rights reserved.</p>
                    <p className="footer-disclaimer">No part of this app may be reproduced, distributed, or transmitted in any form without the express written permission of the developer.</p>
                </div>
            </div>
        </div>
    );

    return (
        <div id="app-container">
            <header>
                <h1>Audio Annotator</h1>
                <button
                    className="manual-btn"
                    onClick={() => setIsManualOpen(true)}
                    aria-label="Open user manual"
                    title="Open user manual"
                >
                    User Manual
                </button>
            </header>
            <main>
                <div className="media-panel">
                    {!mode ? (
                        <div 
                            className="drop-zone-wrapper"
                            onDrop={handleFileDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="template-selector">
                                <label htmlFor="template-select">Annotation Template</label>
                                <select
                                    id="template-select"
                                    value={template}
                                    onChange={(e) => setTemplate(e.target.value as Template)}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label="Select annotation template for audio files"
                                >
                                    <option value="General">General Use</option>
                                    <option value="Legal">Legal Proceedings</option>
                                    <option value="Medical">Medical Dictation</option>
                                    <option value="Academic">Academic / Research</option>
                                    <option value="Accessibility">Accessibility (WCAG)</option>
                                </select>
                            </div>
                            <div 
                                className="drop-zone"
                                onClick={() => document.getElementById('file-input')?.click()}
                            >
                                <p>Drop your audio file here or click to select</p>
                                <input type="file" id="file-input" accept="audio/*" onChange={handleFileSelect} hidden />
                            </div>
                        </div>
                    ) : (
                        <div className="media-player">
                            <audio ref={mediaRef} src={mediaUrl} controls controlsList="nodownload" />
                        </div>
                     )}
                </div>
                <div className="annotations-panel">
                    {isLoading && <div className="loading-overlay">
                        <div className="spinner"></div>
                        <p>Analyzing audio with "{template}" template...</p>
                    </div>}
                    {error && <div className="error-message">{error}</div>}
                    <div className="panel-header">
                        <h2>Annotations</h2>
                        <div className="panel-actions">
                            <button className="undo-btn" onClick={handleUndo} disabled={historyIndex === 0} aria-label="Undo last action" title="Undo last action">Undo</button>
                            <button className="redo-btn" onClick={handleRedo} disabled={historyIndex === history.length - 1} aria-label="Redo last undone action" title="Redo last undone action">Redo</button>
                            <button className="add-btn" onClick={addAnnotation} disabled={!mediaFile} aria-label="Add new annotation at current time" title="Add new annotation at current time">+ Add</button>
                            <div className="download-dropdown-container" ref={downloadDropdownRef}>
                                <button
                                    className="download-btn"
                                    onClick={() => setIsDownloadDropdownOpen(!isDownloadDropdownOpen)}
                                    disabled={annotations.length === 0}
                                    aria-label="Download annotations"
                                    title="Download annotations"
                                >
                                    Download
                                </button>
                                {isDownloadDropdownOpen && (
                                    <div className="download-dropdown-menu">
                                        <button className="download-dropdown-item" onClick={downloadJson}>JSON</button>
                                        <button className="download-dropdown-item" onClick={downloadTxt}>Text (.txt)</button>
                                        <button className="download-dropdown-item" onClick={downloadMd}>Markdown (.md)</button>
                                        <button className="download-dropdown-item" onClick={downloadDocx}>Word (.docx)</button>
                                        <button className="download-dropdown-item" onClick={downloadPdf}>PDF</button>
                                        <button className="download-dropdown-item" onClick={downloadCsv}>CSV</button>
                                        <button className="download-dropdown-item" onClick={downloadXml}>XML</button>
                                        <button className="download-dropdown-item" onClick={downloadSrt}>SRT (Subtitles)</button>
                                        <button className="download-dropdown-item" onClick={downloadVtt}>VTT (Web Captions)</button>
                                    </div>
                                )}
                            </div>
                            <button className="clear-btn" onClick={handleClear} disabled={!mode} aria-label="Clear audio and all annotations" title="Clear audio and all annotations">Clear</button>
                        </div>
                    </div>
                    <div className="annotations-list">
                        {annotations.length === 0 && !isLoading && (
                            <div className="placeholder">
                                {mediaFile ? 'No annotations generated.' : 'Upload an audio file to begin.'}
                            </div>
                        )}
                        {annotations.map((ann, index) => (
                             <div key={index} className="annotation-item" onClick={() => { if (mediaRef.current) { mediaRef.current.currentTime = timeToSeconds(ann.startTime); }}}>
                                <div className="timestamp-inputs">
                                    <input type="text" value={ann.startTime} onChange={(e) => handleAnnotationChange(index, 'startTime', e.target.value)} className="timestamp-input" aria-label={`Start time for annotation ${index + 1}`} />
                                    <span>-</span>
                                    <input type="text" value={ann.endTime} onChange={(e) => handleAnnotationChange(index, 'endTime', e.target.value)} className="timestamp-input" aria-label={`End time for annotation ${index + 1}`} />
                                </div>
                                <button className="delete-btn" onClick={(e) => { e.stopPropagation(); deleteAnnotation(index);}} aria-label={`Delete annotation ${index + 1}`}>{'×'}</button>
                                <div className="annotation-details">
                                     <div className="annotation-field">
                                        <label htmlFor={`speaker-${index}`}>Speaker</label>
                                        <input type="text" id={`speaker-${index}`} value={ann.speaker || ''} onChange={(e) => handleAnnotationChange(index, 'speaker', e.target.value)} />
                                    </div>
                                    <div className="annotation-field">
                                        <label htmlFor={`transcript-${index}`}>Transcript</label>
                                        <textarea id={`transcript-${index}`} value={ann.transcript} onChange={(e) => handleAnnotationChange(index, 'transcript', e.target.value)} />
                                    </div>
                                    <div className="annotation-field">
                                        <label>Sentiment Tags</label>
                                        <div className="tags-container">
                                            {ann.sentimentTags?.map(tag => (
                                                <span key={tag} className="tag-pill sentiment">
                                                    {tag}
                                                    <button onClick={() => removeTag(index, tag, 'sentimentTags')} aria-label={`Remove sentiment tag ${tag}`}>{'×'}</button>
                                                </span>
                                            ))}
                                            <input
                                                type="text"
                                                className="tag-input"
                                                placeholder="Add sentiment..."
                                                onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { addTag(index, e.currentTarget.value, 'sentimentTags'); e.currentTarget.value = ''; e.preventDefault(); } }}
                                            />
                                        </div>
                                    </div>
                                    <div className="annotation-field">
                                        <label>Sound Event Tags</label>
                                         <div className="tags-container">
                                            {ann.soundTags?.map(tag => (
                                                <span key={tag} className="tag-pill sound">
                                                    {tag}
                                                    <button onClick={() => removeTag(index, tag, 'soundTags')} aria-label={`Remove sound tag ${tag}`}>{'×'}</button>
                                                </span>
                                            ))}
                                            <input
                                                type="text"
                                                className="tag-input"
                                                placeholder="Add sound event..."
                                                onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { addTag(index, e.currentTarget.value, 'soundTags'); e.currentTarget.value = ''; e.preventDefault(); } }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
            {isManualOpen && <ManualModal />}
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
