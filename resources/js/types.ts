export interface FileItem {
    id: number;
    name: string;
    type: 'file' | 'folder';
    size?: number;
    modified_at: Date;
    path: string;
    url?: string | null;
    mime_type?: string | null;
}