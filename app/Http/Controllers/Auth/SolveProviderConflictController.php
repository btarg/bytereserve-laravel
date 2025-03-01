<?php
namespace App\Http\Controllers\Auth;
use App\Http\Controllers\Controller;
use Laravel\Socialite\Facades\Socialite;

class SolveProviderConflictController extends Controller
{
    public function solveProviderConflict()
    {
        $conflictData = session()->get('provider_conflict');

        if (
            !$conflictData ||
            now()->isAfter($conflictData['expires_at'])
        ) {
            session()->forget('provider_conflict');
            return redirect()->route('login')
                ->with('error', 'Invalid or expired provider link request');
        }

        // The key fix: Return a DIRECT redirect response, not an Inertia response
        // This prevents Inertia from trying to handle it as an XHR request
        $redirectUrl = Socialite::driver($conflictData['originalProvider'])->redirect()->getTargetUrl();
        
        // Return a plain HTTP redirect to the OAuth provider
        return redirect()->away($redirectUrl);
    }

    public function cancelConflictResolution()
    {
        session()->forget('provider_conflict');
        return redirect()->route('login')
            ->with('status', 'Conflict resolution cancelled');
    }
}