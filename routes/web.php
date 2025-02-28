<?php

use App\Http\Controllers\Auth\SolveProviderConflictController;
use App\Http\Controllers\Auth\SocialiteController;
use App\Http\Controllers\S3UploadController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\FileExplorerController;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    return Inertia::render('Welcome', [
        'canLogin' => Route::has('login'),
        'canRegister' => Route::has('register'),
        'laravelVersion' => Application::VERSION,
        'phpVersion' => PHP_VERSION,
    ]);
});

Route::get('/dashboard', function () {
    return Inertia::render('Dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
}); 

Route::get('login/{provider}', [SocialiteController::class, 'redirectToProvider'])
    ->name('socialite.redirect');
Route::get('login/{provider}/callback', [SocialiteController::class, 'handleProviderCallback'])
->name('socialite.callback');

Route::get(
    'auth/conflict',
    [SocialiteController::class, 'showProviderConflict']
)->name('provider.conflict');

Route::get(
    'auth/conflict/solve',
    [SolveProviderConflictController::class, 'solveProviderConflict']
)
->name('provider.conflict.solve');

Route::post('auth/conflict/verify-password',
    [SocialiteController::class, 'verifyPasswordAndLink'])
    ->name('provider.conflict.verify');

Route::get('auth/conflict/cancel', [SolveProviderConflictController::class, 'cancelConflictResolution'])
    ->name('provider.conflict.cancel');

Route::prefix('api/uploads')->group(function () {
    Route::post('/direct-url', [S3UploadController::class, 'getDirectUploadUrl'])
        ->name('uploads.get-direct-url');
    Route::post('/multipart/initiate', [S3UploadController::class, 'initiateMultipartUpload'])
        ->name('uploads.initiate-multipart');
    Route::post('/multipart/part-url', [S3UploadController::class, 'getBulkPartUploadUrls'])
        ->name('uploads.get-part-url');
    Route::post('/multipart/complete', [S3UploadController::class, 'completeMultipartUpload'])
        ->name('uploads.complete-multipart');
    Route::post('/multipart/abort', [S3UploadController::class, 'abortMultipartUpload'])
        ->name('uploads.abort-multipart');
    Route::post('/details', [S3UploadController::class, 'getFileDetails']);
});

Route::prefix('api')->middleware('auth')->group(function () {
    Route::get('/explorer', [FileExplorerController::class, 'index'])->name('explorer.index');
    Route::post('/files', [FileExplorerController::class, 'storeFile'])->name('files.store');
    Route::post('/folders', [FileExplorerController::class, 'storeFolder'])->name('folders.store');
    Route::get('/files/{file}/download', [FileExplorerController::class, 'download'])->name('files.download');
    Route::delete('/files/{file}', [FileExplorerController::class, 'destroyFile'])->name('files.destroy');
    Route::delete('/folders/{folder}', [FileExplorerController::class, 'destroyFolder'])->name('folders.destroy');
});

require __DIR__.'/auth.php';
