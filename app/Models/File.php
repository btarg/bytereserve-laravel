<?php
namespace App\Models;

use App\Traits\S3Capable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Cache;

class File extends Model
{
    use HasFactory, S3Capable;

    protected $fillable = [
        'user_id',
        'folder_id',
        'name',
        'path',
        'mime_type',
        'size',
        'hash',
        'expires_at'
    ];

    protected $casts = [
        'expires_at' => 'datetime'
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /**
     * Get a short-lived presigned URL for the file
     */
    public function getPresignedUrl($expiresIn = 15, $forPreview = false): string
    {
        $cacheKey = "file_url_{$this->id}_" . ($forPreview ? 'preview' : 'download');

        return Cache::remember($cacheKey, $expiresIn * 60, function () use ($expiresIn, $forPreview) {
            $s3Client = $this->getS3Client();
            if (!$s3Client) {
                return '';
            }

            $commandParams = [
                'Bucket' => $this->getS3Bucket(),
                'Key' => $this->path, // Using path directly as the S3 key
            ];

            if ($forPreview) {
                // For previews, serve inline with proper content type
                $commandParams['ResponseContentType'] = $this->mime_type;
                $commandParams['ResponseContentDisposition'] = 'inline; filename="' . $this->name . '"';
            } else {
                // For downloads, force attachment with proper content type
                $commandParams['ResponseContentType'] = $this->mime_type;
                $commandParams['ResponseContentDisposition'] = 'attachment; filename="' . $this->name . '"';
            }

            // Create a presigned URL that will expire
            $command = $s3Client->getCommand('GetObject', $commandParams);

            $presignedRequest = $s3Client->createPresignedRequest($command, "+{$expiresIn} minutes");

            return (string) $presignedRequest->getUri();
        });
    }

    /**
     * Get a short-lived presigned URL for preview (inline display)
     */
    public function getPreviewUrl($expiresIn = 15): string
    {
        return $this->getPresignedUrl($expiresIn, true);
    }

    /**
     * Check if the file has expired
     */
    public function hasExpired(): bool
    {
        if (!$this->expires_at) {
            return false;
        }

        return $this->expires_at->isPast();
    }

    /**
     * Check if the file is valid (not expired)
     */
    public function isValid(): bool
    {
        return !$this->hasExpired();
    }

    /**
     * Scope to find expired files
     */
    public function scopeExpired($query)
    {
        return $query->where('expires_at', '<', now())
                    ->whereNotNull('expires_at');
    }

    /**
     * Scope to find valid (non-expired) files
     */
    public function scopeValid($query)
    {
        return $query->where(function ($query) {
            $query->where('expires_at', '>', now())
                  ->orWhereNull('expires_at');
        });
    }
}