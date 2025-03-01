<?php
namespace App\Http\Controllers\Auth;

use Illuminate\Http\Request;
use Laravel\Socialite\Facades\Socialite;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;
use App\Http\Controllers\Controller;

class SocialiteController extends Controller
{
    public function redirectToProvider($provider)
    {
        return Socialite::driver($provider)
            ->redirect();
    }

    public function handleSolveProviderConflictCallback($conflictData, $provider)
    {
        $user = User::where('email', $conflictData['email'])->first();
        if (!$user || $user->email !== $conflictData['email']) {
            return redirect()->route('login')
                ->with('error', 'Please login with your original provider first');
        }
        // Add the new provider
        $user->providers()->create([
            'provider' => $conflictData['newProviderName'],
            'provider_id' => $conflictData['provider_id']
        ]);

        // Clear the session data
        session()->forget('provider_conflict');

        Auth::login($user, true);
        return redirect('/dashboard')
            ->with('status', 'Provider linked successfully');


    }

    public function handleProviderCallback($provider)
    {
        // 1. Check if we're in conflict resolution
        $conflictData = session()->get('provider_conflict');
        if ($conflictData) {
            return $this->handleSolveProviderConflictCallback($conflictData, $provider);
        }
    
        // 2. Get social user data
        $socialUser = Socialite::driver($provider)->user();
        $token = Str::random(40);
    
        // 3. Check email existence first
        $existingUser = User::where('email', $socialUser->getEmail())->first();
    
        if ($existingUser) {
            // 4a. Check for exact provider match
            $exactProvider = $existingUser->providers()
                ->where('provider', $provider)
                ->where('provider_id', $socialUser->getId())
                ->first();
    
            if ($exactProvider) {
                Auth::login($existingUser, true);
                return redirect('/dashboard');
            }
    
            // 4b. No exact match, start conflict resolution
            $originalProvider = $existingUser->providers()->first();
            $originalProviderName = $originalProvider ? $originalProvider->provider : 'email';
    
            session([
                'provider_conflict' => [
                    'token' => $token,
                    'email' => $socialUser->getEmail(),
                    'originalProvider' => $originalProviderName,
                    'newProviderName' => $provider,
                    'provider_id' => $socialUser->getId(),
                    'expires_at' => now()->addMinutes(15)
                ]
            ]);
            return redirect()->route('provider.conflict');
        }
    
        // 5. Create new user if no email exists
        $user = User::create([
            'id' => Str::uuid(),
            'name' => $socialUser->getName(),
            'email' => $socialUser->getEmail(),
            'password' => bcrypt(Str::random(16))
        ]);
    
        $user->providers()->create([
            'provider' => $provider,
            'provider_id' => $socialUser->getId()
        ]);
    
        Auth::login($user, true);
        return redirect('/dashboard');
    }
    
    public function showProviderConflict()
    {
        $conflict_object = session()->get('provider_conflict');
        if ($conflict_object['originalProvider'] == 'email') {
            return Inertia::render('Auth/VerifyPassword', [
                'token' => $conflict_object['token'],
                'email' => $conflict_object['email'],
                'originalProvider' => $conflict_object['originalProvider'],
                'newProviderName' => $conflict_object['newProviderName'],
            ]);
        }

        return Inertia::render('Auth/ProviderConflict', [
            'token' => $conflict_object['token'],
            'email' => $conflict_object['email'],
            'originalProvider' => $conflict_object['originalProvider'],
            'newProviderName' => $conflict_object['newProviderName'],
        ]);
    }

    public function verifyPasswordAndLink(Request $request)
    {
        $conflictData = session()->get('provider_conflict');
        
        if (!$conflictData || $conflictData['token'] !== $request->token) {
            return redirect()->route('login')
                ->with('error', 'Invalid token');
        }
    
        $user = User::where('email', $conflictData['email'])->first();
    
        if (!$user || !Hash::check($request->password, $user->password)) {
            return back()->withErrors([
                'password' => 'The provided password is incorrect.'
            ]);
        }
    
        // Add the new provider
        $user->providers()->create([
            'provider' => $conflictData['newProviderName'],
            'provider_id' => $conflictData['provider_id']
        ]);
    
        session()->forget('provider_conflict');
    
        Auth::login($user, true);
        return redirect('/dashboard')
            ->with('status', 'Account linked successfully');
    }
}