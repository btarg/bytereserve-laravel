import {
    DocumentTextIcon,
    PhotoIcon,
    VideoCameraIcon,
    MusicalNoteIcon,
    DocumentIcon,
    ArchiveBoxIcon,
    CodeBracketIcon,
    TableCellsIcon,
    DocumentArrowDownIcon,
    PresentationChartLineIcon,
    DocumentChartBarIcon
} from '@heroicons/vue/24/outline';

export interface FileTypeIcon {
    icon: any;
    color: string;
    bgColor: string;
}

export function getFileTypeIcon(fileName: string, mimeType?: string): FileTypeIcon {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mime = mimeType?.toLowerCase();

    // Images
    if (mime?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico'].includes(ext || '')) {
        return {
            icon: PhotoIcon,
            color: 'text-green-500',
            bgColor: 'bg-green-100'
        };
    }

    // Videos
    if (mime?.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v', '3gp'].includes(ext || '')) {
        return {
            icon: VideoCameraIcon,
            color: 'text-red-500',
            bgColor: 'bg-red-100'
        };
    }

    // Audio
    if (mime?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus'].includes(ext || '')) {
        return {
            icon: MusicalNoteIcon,
            color: 'text-purple-500',
            bgColor: 'bg-purple-100'
        };
    }

    // PDFs
    if (mime === 'application/pdf' || ext === 'pdf') {
        return {
            icon: DocumentArrowDownIcon,
            color: 'text-red-600',
            bgColor: 'bg-red-100'
        };
    }

    // Text files
    if (mime?.startsWith('text/') || ['txt', 'md', 'markdown', 'log', 'rtf'].includes(ext || '')) {
        return {
            icon: DocumentTextIcon,
            color: 'text-gray-600',
            bgColor: 'bg-gray-100'
        };
    }

    // Code files
    if (['js', 'ts', 'jsx', 'tsx', 'vue', 'php', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'rb', 'swift', 'kt', 'dart', 'html', 'css', 'scss', 'sass', 'less', 'sql', 'sh', 'bash', 'ps1', 'bat', 'cmd'].includes(ext || '')) {
        return {
            icon: CodeBracketIcon,
            color: 'text-indigo-600',
            bgColor: 'bg-indigo-100'
        };
    }

    // Spreadsheets
    if (['xlsx', 'xls', 'csv', 'ods'].includes(ext || '') || mime?.includes('spreadsheet')) {
        return {
            icon: TableCellsIcon,
            color: 'text-green-600',
            bgColor: 'bg-green-100'
        };
    }

    // Presentations
    if (['pptx', 'ppt', 'odp'].includes(ext || '') || mime?.includes('presentation')) {
        return {
            icon: PresentationChartLineIcon,
            color: 'text-orange-600',
            bgColor: 'bg-orange-100'
        };
    }

    // Documents
    if (['docx', 'doc', 'odt', 'pages'].includes(ext || '') || mime?.includes('document')) {
        return {
            icon: DocumentChartBarIcon,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100'
        };
    }

    // Archives
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'z', 'lz', 'lzma', 'dmg', 'iso'].includes(ext || '')) {
        return {
            icon: ArchiveBoxIcon,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-100'
        };
    }

    // Default
    return {
        icon: DocumentIcon,
        color: 'text-gray-500',
        bgColor: 'bg-gray-100'
    };
}

export function getFileTypeIconComponent(fileName: string, mimeType?: string, size: string = 'w-5 h-5') {
    const { icon: IconComponent, color } = getFileTypeIcon(fileName, mimeType);
    return { IconComponent, color, size };
}
